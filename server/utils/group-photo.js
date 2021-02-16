const sharp = require('sharp')
const fs = require('fs')

const chunkArray = (array, size) => {
  if (!array) return []
  const firstChunk = array.slice(0, size)
  if (!firstChunk.length) return array
  return [firstChunk].concat(chunkArray(array.slice(size, array.length), size))
}

const createImageLayout = (imgs) => {
  const aspectRatio = 1 + 1 / 3

  const count = imgs.length

  const idealGridWidth = 2000
  const rowCellCount = Math.ceil(Math.sqrt(count))
  const colCellCount = Math.ceil(count / rowCellCount)

  const imgWidth = Math.round(idealGridWidth / rowCellCount) // these need to be an integer
  const imgHeight = Math.round(imgWidth / aspectRatio)

  const gridWidth = imgWidth * rowCellCount
  const gridHeight = imgHeight * colCellCount

  let top = 0
  let left = 0
  const _imgs = imgs.map((img) => {
    const specs = {
      data: img,
      top,
      left,
      width: imgWidth,
      height: imgHeight,
    }

    left += imgWidth
    if (left >= gridWidth) {
      left = 0
      top += imgHeight
    }

    return specs
  })

  return {
    imgs: _imgs,
    height: gridHeight,
    width: gridWidth,
    imgWidth,
    imgHeight,
    rowCellCount,
    colCellCount,
  }
}

const createJpegComposite = async (buffer, { width, height, top, left }) => {
  try {
    const resizedBuffer = await sharp(buffer)
      .resize(width, height)
      .raw()
      .toBuffer({ resolveWithObject: true })

    return {
      input: resizedBuffer.data,
      raw: resizedBuffer.info,
      top,
      left,
    }
  } catch (e) {
    console.log('Image Resize Failed')
    return null
  }
}

const createGroupPhoto = async (buffers) => {
  const padding = 16
  const brandingHeight = 80
  const conferenceOutputPath = './temp/conference_logo.png'

  const layout = createImageLayout(buffers)

  await sharp('./branding/Logo.png')
    .resize(null, brandingHeight)
    .toFile(conferenceOutputPath)
  const imgLogo = await sharp(conferenceOutputPath)
  const logoMetadata = await imgLogo.metadata()

  const totalWidth = layout.width + padding * 2
  const totalHeight = layout.height + logoMetadata.height + padding * 3

  const imgRows = chunkArray(layout.imgs, layout.rowCellCount)

  // compositing the images row by row before the main composite to create the group photo
  // compositing all assets at once (> 300 or so) made sharp crash
  const greetingsComposites = await Promise.all(
    imgRows.map(async (row, i) => {
      const composites = await Promise.all(
        row.map((img) =>
          createJpegComposite(img.data, {
            top: 0,
            left: img.left,
            width: layout.imgWidth,
            height: layout.imgHeight,
          }),
        ),
      )
      const buffer = await sharp({
        create: {
          height: layout.imgHeight,
          width: layout.rowCellCount * layout.imgWidth,
          background: '#EDF2F7',
          channels: 3,
        },
      })
        .composite(composites.filter((c) => c))
        .toBuffer({ resolveWithObject: true })

      return {
        input: buffer.data,
        raw: buffer.info,
        top: i * layout.imgHeight + padding,
        left: padding,
      }
    }),
  )

  const background = await sharp({
    create: {
      height: totalHeight,
      width: totalWidth,
      channels: 3,
      background: 'white',
    },
  })

  const backdropComposite = {
    input: {
      create: {
        height: layout.height,
        width: layout.width,
        background: '#EDF2F7',
        channels: 3,
      },
    },
    top: padding,
    left: padding,
  }

  const logoComposite = {
    input: conferenceOutputPath,
    top: layout.height + padding * 2,
    left: Math.floor(totalWidth / 2 - logoMetadata.width / 2),
  }

  const groupPhoto = await background.composite([
    backdropComposite,
    ...greetingsComposites,
    logoComposite,
  ])

  return groupPhoto
}

const outputPath = './temp/group-photo.jpeg'

const createGroupPhotoStream = async (buffers) => {
  try {
    const groupPhoto = await createGroupPhoto(buffers)
    console.log('Group photo processed')
    const jpeg = await groupPhoto.jpeg({
      quality: 75,
    })
    await jpeg.toFile(outputPath)
    console.log(`Group photo output to ${outputPath}`)
    return fs.createReadStream(outputPath)
  } catch (e) {
    console.log(e)
    return null
  }
}

const outputGifToJpeg = async (path) => {
  let frame
  const firstPage = await sharp(path)
  try {
    const { pages } = await firstPage.metadata()
    const page = Math.round(pages / 2) || 0
    const middlePage = await sharp(path, { page })
    frame = middlePage
  } catch (e) {
    // so far we have only seen faulty gifs cause this to catch
    console.log(
      'Failed to slice middle GIF page, defaulting to first page:',
      path,
    )
    frame = firstPage
  }
  const filepath = path.replace('.gif', '.jpeg')
  await frame.jpeg({ quality: 75 }).toFile(filepath)
  return filepath
}

module.exports = { outputGifToJpeg, createGroupPhotoStream }
