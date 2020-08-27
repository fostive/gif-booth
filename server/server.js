const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AWS = require('aws-sdk');
const { createGroupPhotoStream } = require('./utils/group-photo');

// BEFORE MERGING LOOK HERE!!!!!!
// this needs to be replaced when dev is over here and in usePhotos.js:
// const s3URL = 'https://bucketeer-7dcba73d-2692-4191-be53-1b4e69bfff3d.s3.amazonaws.com/';
const s3URL = 'https://gif-app-test.s3.us-east-2.amazonaws.com/';

if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const s3 = new AWS.S3({
  accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
  region: 'us-east-1',
});

const app = express();
app.set('port', process.env.PORT || 3001);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('client/build'));
  app.get('/new-gif', (req, res) =>
    res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'))
  );
}
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/');
  },
  filename: (req, file, cb) => {
    const filename = `${Date.now()}.webm`;
    cb(null, filename);
  },
});
const upload = multer({ storage });

const listGifs = async () => {
  try {
    const params = {
      Bucket: process.env.BUCKETEER_BUCKET_NAME,
      Prefix: 'gifs/',
    };
    const result = await s3.listObjects(params).promise();
    result.Contents = result.Contents.reduce(
      (acc, file) =>
        file.Key.includes('.gif')
          ? [...acc, { ...file, src: `${s3URL}${file.Key}` }]
          : acc,
      []
    );
    return result;
  } catch (e) {
    console.log(e);
  }
};

app.get('/listGifs', async (_, res) => {
  const result = await listGifs();
  res.send(result);
});

app.post('/getGroupPhoto', async (_, res) => {
  const params = {
    Bucket: process.env.BUCKETEER_BUCKET_NAME,
    Prefix: 'group_photo.png',
  };
  const result = await s3.listObjects(params).promise();
  result.Contents = result.Contents.map((file) => ({
    ...file,
    Location: `${s3URL}${file.Key}`,
  }));
  res.send(result);
});

app.post('/createGroupPhoto', async (_, res) => {
  const result = await listGifs();
  try {
    const urls = result.Contents.map((gif) => `${s3URL}${gif.Key}`);
    const stream = await createGroupPhotoStream(urls);
    const params = {
      Key: 'group_photo.png',
      Bucket: process.env.BUCKETEER_BUCKET_NAME,
      Body: stream,
      ContentType: 'image/png',
      ACL: 'public-read',
    };
    s3.upload(params, (err, data) => {
      if (err) {
        console.log(err, err.stack);
        return;
      } else {
        data.LastModified = Date.now();
        res.send(data);
      }
    });
  } catch (e) {
    console.log(e);
  }
});

app.post('/uploadGIF', ({ body }, res) => {
  const { filename } = body;
  const path = `temp/${filename}.gif`;
  const fileStream = fs.createReadStream(path);
  const params = {
    Key: `gifs/${filename}.gif`,
    Bucket: process.env.BUCKETEER_BUCKET_NAME,
    Body: fileStream,
    ContentType: 'image/gif',
    ACL: 'public-read',
  };

  s3.upload(params, (err, data) => {
    if (err) {
      console.log(err, err.stack);
      return;
    } else {
      console.log('s3.upload', data);
      fs.unlink(`uploads/${filename}.webm`, () =>
        console.log('.webm file was deleted')
      );
      fs.unlink(`uploads/${filename}.png`, () =>
        console.log('.png file was deleted')
      );
      fs.unlink(path, () => console.log('.gif file was deleted'));
      res.send(data);
    }
  });
});

app.post('/');

app.post('/video2gif', upload.none(), ({ body }, res) => {
  const { videoId, text, fontsize } = body;
  ffmpeg()
    .input(`uploads/${videoId}.webm`)
    .input('uploads/CascadiaJS.png')
    .complexFilter([
      '[1]scale=iw*.2:-1[a]',
      '[0][a]overlay=x=20:y=15[b]',
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
      //console.log('res: ', body);
      res.send(body);
    })
    .on('error', (err) => {
      console.log('an error happened: ' + err.message);
      res.send(err);
    })
    .save(`temp/${videoId}.gif`);
});

app.post('/uploadBlob', upload.single('video'), ({ file }, res) => {
  const filename = file.path.replace('webm', 'png');
  ffmpeg(file.path)
    .screenshots({
      timestamps: [0],
      filename,
      size: '320x240',
    })
    .on('end', () => {
      res.send(file);
    });
});

app.get('/video', (req, res) => {
  const { filename } = req.query;
  const path = `uploads/${filename}`;
  const stat = fs.statSync(path);
  const fileSize = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunksize = end - start + 1;
    const file = fs.createReadStream(path, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/webm',
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/webm',
    };
    res.writeHead(200, head);
    fs.createReadStream(path).pipe(res);
  }
});

app.get('/img', (req, res) => {
  const { filename } = req.query;
  const path = `temp/${filename}.gif`;
  const stat = fs.statSync(path);
  const fileSize = stat.size;
  const ext = filename.split('/').pop();
  const head = {
    'Content-Length': fileSize,
    'Content-Type': `image/${ext}`,
  };
  res.writeHead(200, head);
  fs.createReadStream(path).pipe(res);
});

app.get('/poster', (req, res) => {
  const { filename } = req.query;
  const path = `uploads/${filename}`;
  const stat = fs.statSync(path);
  const fileSize = stat.size;
  const head = {
    'Content-Length': fileSize,
    'Content-Type': `image/png`,
  };
  res.writeHead(200, head);
  fs.createReadStream(path).pipe(res);
});

app.get('/download', (req, res) => {
  const { filename } = req.query;
  const path = `temp/${filename}.gif`;
  res.download(path, (err) => {
    if (err) console.log(err);
    console.log('Your file has been downloaded!');
  });
});

app.get('/s3-download', async (req, res) => {
  const { filename } = req.query;
  const params = {
    Bucket: process.env.BUCKETEER_BUCKET_NAME,
    Key: filename,
  };
  s3.getObject(params, (err, data) => {
    if (err) console.log(err, err.stack);
    else {
      console.log('get file', data);
      res.send(data.Body);
    }
  });
});

app.delete('/deleteObj', ({ body }, res) => {
  const { filename } = body;
  const params = {
    Bucket: process.env.BUCKETEER_BUCKET_NAME,
    Key: filename,
  };
  s3.deleteObject(params, (err, data) => {
    if (err) console.log(err, err.stack);
    else res.send(data);
  });
});

app.listen(app.get('port'), () => {
  console.log(`Find the server at: http://localhost:${app.get('port')}/`);
});