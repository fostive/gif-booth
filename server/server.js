/* eslint-disable-next-line global-require */
if (process.env.NODE_ENV !== 'production') require('dotenv').config()

const express = require('express')
const basicAuth = require('express-basic-auth')
const ffmpeg = require('fluent-ffmpeg')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const AWS = require('aws-sdk')
const { Server } = require('ws')
const { v4: uuidv4 } = require('uuid')
const config = require('../config')
const {
  outputGifToJpeg,
  createGroupPhotoStream,
} = require('./utils/group-photo')

const getFileLocation = (file) =>
  `https://${config.AWS_BUCKET_NAME}.s3.amazonaws.com/${file.Key}`

const s3 = new AWS.S3({
  accessKeyId: config.AWS_ACCESS_KEY_ID,
  secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  region: config.AWS_REGION,
})

const auth = basicAuth({
  users: {
    [config.AUTH_USERNAME]: config.AUTH_PASSWORD,
  },
})

const app = express()
app.set('port', process.env.PORT || 3001)
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, './uploads/')
  },
  filename(req, file, cb) {
    const id = uuidv4()
    let filename = `${id}.${file.originalname.split('.')[1]}`
    if (req.path === '/uploadBlob') {
      filename = `${id}.webm`
    }
    cb(null, filename)
  },
})

const upload = multer({ storage })

const GREETING_PREFIX = 'public/gifs/greeting-'
const PHOTO_PREFIX = 'public/photos/photo-'

const listByPrefix = async (Prefix) => {
  const params = {
    Bucket: config.AWS_BUCKET_NAME,
    Prefix,
  }

  const getAllContents = async (PrevContents = [], NextContinuationToken) => {
    const result = await s3
      .listObjectsV2({
        ...params,
        ...(NextContinuationToken
          ? { ContinuationToken: NextContinuationToken }
          : {}),
      })
      .promise()
    const Contents = [...PrevContents, ...result.Contents]
    return result.NextContinuationToken
      ? getAllContents(Contents, result.NextContinuationToken)
      : Contents
  }

  const Contents = await getAllContents()

  const OrderedContents = Contents.map((file) => ({
    ...file,
    Location: getFileLocation(file),
  })).sort((a, b) => b.LastModified - a.LastModified)

  return OrderedContents
}

app.get('/listGifs', async (_, res) => {
  try {
    const result = await listByPrefix(GREETING_PREFIX)
    res.send(result)
  } catch (e) {
    console.log(e)
  }
})

const uploadGIF = async (res, filename, folderName, onSuccess = () => {}) => {
  const filepath = `${folderName}/${filename}.gif`
  try {
    const fileStream = fs.createReadStream(filepath)
    const GifKey = `${GREETING_PREFIX}${filename}.gif`
    const PhotoKey = `${PHOTO_PREFIX}${filename}.jpeg`

    const params = {
      Key: GifKey,
      Bucket: config.AWS_BUCKET_NAME,
      Body: fileStream,
      ContentType: 'image/gif',
      ACL: 'public-read',
    }
    const data = await s3.upload(params).promise()
    console.log('Uploaded user gif to', data.Location)

    res.send(data)
    onSuccess()

    const jpegPath = await outputGifToJpeg(filepath)
    const jpegStream = fs.createReadStream(jpegPath)

    // upload the middle page of the gif to s3 as a JPEG to enable faster processing of group photo
    await s3
      .upload({
        ...params,
        Key: PhotoKey,
        Body: jpegStream,
        ContentType: 'image/jpeg',
      })
      .promise()

    fs.unlink(filepath, () =>
      console.log(`${filepath} was deleted after upload`),
    )
    fs.unlink(jpegPath, () =>
      console.log(`${jpegPath} was deleted after upload`),
    )
  } catch (e) {
    console.log(e, e.stack, filepath)
    res.status(500).send(e)
  }
}

app.post('/uploadUserGIF', upload.single('gif'), async (req, res) => {
  const gif = req.file
  if (!gif) {
    res.status(400).send({
      status: false,
      data: 'No file is selected.',
    })
  } else {
    const filename = gif.filename.replace('.gif', '')
    uploadGIF(res, filename, 'uploads')
  }
})

app.post('/uploadGIF', ({ body }, res) => {
  const { filename } = body
  uploadGIF(res, filename, 'temp', () => {
    const filepath = `uploads/${filename}.webm`
    fs.unlink(filepath, () => console.log(`${filepath} was deleted`))
  })
})

app.post('/video2gif', upload.none(), ({ body }, res) => {
  const { videoId, text, fontsize } = body
  ffmpeg()
    .input(`uploads/${videoId}.webm`)
    .input('branding/LogoCompact.png')
    .complexFilter([
      '[1]scale=iw*1:-1[a]',
      '[0][a]overlay=x=20:y=20[b]',
      '[b]scale=320:-1:flags=lanczos,fps=15[c]',
      {
        filter: 'drawtext',
        options: {
          text: text.replace(/\r?\n|\r/gm, '\v'),
          fontsize,
          fontcolor: 'white',
          x: '(w-text_w)/2',
          y: '(h-text_h)*.95',
          shadowcolor: 'black',
          shadowx: 2,
          shadowy: 2,
        },
        inputs: 'c',
      },
    ])
    .on('end', () => {
      res.send(body)
    })
    .on('error', (err) => {
      console.log(`The following error occured: ${err.message}`)
      res.send(err)
    })
    .save(`temp/${videoId}.gif`)
})

app.post('/uploadBlob', upload.single('video'), ({ file }, res) => {
  res.send(file)
})

app.get('/img', (req, res) => {
  const { filename } = req.query
  const filepath = `temp/${filename}.gif`
  const stat = fs.statSync(filepath)
  const fileSize = stat.size
  const ext = filename.split('/').pop()
  const head = {
    'Content-Length': fileSize,
    'Content-Type': `image/${ext}`,
  }
  res.writeHead(200, head)
  fs.createReadStream(filepath).pipe(res)
})

app.get('/download', (req, res) => {
  const { filename } = req.query
  const filepath = `temp/${filename}.gif`
  res.download(filepath, (err) => {
    if (err) console.log(err)
    console.log(`User downloaded ${filepath}`)
  })
})

app.get('/s3-download', async (req, res) => {
  const { filename } = req.query
  const params = {
    Bucket: config.AWS_BUCKET_NAME,
    Key: filename,
  }
  s3.getObject(params, (err, data) => {
    if (err) console.log(err, err.stack)
    else {
      res.send(data.Body)
    }
  })
})

app.delete('/deleteObj', auth, ({ body }, res) => {
  const { filename } = body
  const params = {
    Bucket: config.AWS_BUCKET_NAME,
    Key: filename,
  }
  s3.deleteObject(params, (err, data) => {
    if (err) console.log(err, err.stack)
    else res.send(data)
  })
})

app.use(express.static(path.join(__dirname, '../client/build')))
app.get('/*', (req, res) =>
  res.sendFile(path.join(__dirname, '../client/build', 'index.html')),
)

const server = app.listen(app.get('port'), () => {
  console.log(`Find the server at: http://localhost:${app.get('port')}/`)
})

const wss = new Server({ server })

const groupPhotoPath = 'public/group_photo.jpeg'

app.post('/getGroupPhoto', async (_, res) => {
  const params = {
    Bucket: config.AWS_BUCKET_NAME,
    Prefix: groupPhotoPath,
  }
  const result = await s3.listObjects(params).promise()
  result.Contents = result.Contents.map((file) => ({
    ...file,
    Location: getFileLocation(file),
  }))
  res.send(result)
})

const fetchImageBuffer = (image) => {
  const params = { Bucket: config.AWS_BUCKET_NAME, Key: image.Key }
  return new Promise((resolve, reject) =>
    s3.getObject(params, (error, result) =>
      error ? reject(error) : resolve(result.Body),
    ),
  )
}

app.post('/createGroupPhoto', async (req, res) => {
  res.send({ message: 'Starting group photo processing' })
  try {
    console.log('Starting group photo creation')
    const images = await listByPrefix(PHOTO_PREFIX)
    const buffers = await Promise.all(
      images.map((image) => fetchImageBuffer(image)),
    )
    console.log('Group photo input buffers fetched from s3')
    const stream = await createGroupPhotoStream(buffers)
    if (!stream) return
    const params = {
      Key: groupPhotoPath,
      Bucket: config.AWS_BUCKET_NAME,
      Body: stream,
      ContentType: 'image/png',
      ACL: 'public-read',
    }
    s3.upload(params, (err, data) => {
      if (err) {
        console.log(err, err.stack)
      } else {
        console.log(`Group photo uploaded to s3: ${groupPhotoPath}`)
        const _data = {
          ...data,
          LastModified: Date.now(),
        }
        wss.clients.forEach((client) => {
          client.send(
            JSON.stringify({
              id: 'group-photo',
              status: 200,
              data: _data,
              message: 'Group photo processed successfully',
            }),
          )
        })
      }
    })
  } catch (e) {
    wss.clients.forEach((client) => {
      client.send(
        JSON.stringify({
          id: 'group-photo',
          status: 500,
          message: 'Group photo processing failed',
          error: e,
        }),
      )
    })
  }
})
