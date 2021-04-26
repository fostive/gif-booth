import React, { useState, useCallback, useEffect } from 'react'
import download from 'downloadjs'
import { Link } from 'react-router-dom'
import './Create.css'
import Select from 'react-select'
import Webcam from '../../components/WebcamCapture'
import Countdown from '../../components/Countdown'
import Page from '../../components/Page'
import Icon from '../../components/Icon'
import Button from '../../components/Button'
import GenericWarning from './GenericWarning'
import BrowserWarning from './BrowserWarning'
import noCameraImgSrc from '../../no_camera.png'

const WARNING_BROWSER = 'warning_browser'
const WARNING_GENERIC = 'warning_generic'

const PHASE_START = 'phase_start'
const PHASE_COUNTDOWN = 'phase_countdown'
const PHASE_RECORDING = 'phase_recording'
const PHASE_TEXT = 'phase_text'
const PHASE_END = 'phase_end'

function Create({ history }) {
  const [phase, setPhase] = useState(PHASE_START)
  const [recodingInput, setRecordingInput] = useState(null)
  const [isWebcamReady, setIsWebcamReady] = useState(false)
  const [gifId, setGifId] = useState()
  const [text, setText] = useState('')
  const [textLimitError, setTextLimitError] = useState('')
  const [isProcessingGif, setIsProcessingGif] = useState('')
  const [isUploading, setUploading] = useState(false)
  const [warning, setWarning] = useState(
    window.MediaRecorder ? false : WARNING_BROWSER,
  )
  const [webCamDenied, setWebCamDenied] = useState(true)
  const [webCamSelectPlaceHolder, setWebCamSelectPlaceHolder] = useState(
    'Please accept browser webcam permissions',
  )
  const [webCamOptions, setWebCamOptions] = useState([])

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: true,
      })
      .then(() => {
        navigator.mediaDevices
          .enumerateDevices()
          .then((inputs) => {
            const options = []
            inputs
              .filter((input) => {
                return input.kind === 'videoinput'
              })
              .forEach((videoInput) => {
                options.push({
                  value: videoInput,
                  label: videoInput.label,
                })
              })

            if (options.length < 1) {
              setWebCamSelectPlaceHolder('No camera detected...')
              setWebCamDenied(true)
            } else {
              setWebCamDenied(false)
              setWebCamSelectPlaceHolder('Select your camera...')
              setWebCamOptions(options)
            }
          })
          .catch((err) => {
            console.error('ERROR: No camera input found', err)
          })
      })
      .catch((err) => {
        console.error(err)
        setWebCamSelectPlaceHolder('You have denied webcam permissions')
        setWebCamDenied(true)
      })
  }, [])

  const retry = () => {
    setGifId(null)
    setText('')
    setPhase(PHASE_START)
    setWarning(false)
  }

  const onError = useCallback(
    (error) => {
      console.error('Error:', error)
      setWarning(WARNING_GENERIC)
    },
    [setWarning],
  )

  const createGIF = useCallback(
    (vidId, callback) => {
      setIsProcessingGif(true)
      const formData = new FormData()
      const fontsize = text.length && 340 / text.length
      formData.append('text', text)
      formData.append('fontsize', fontsize)
      formData.append('videoId', vidId)
      fetch('/video2gif', {
        method: 'POST',
        body: formData,
      })
        .then((res) => res.json())
        .then((response) => {
          if (!Object.keys(response).length) {
            throw Error
          }
          setGifId(response.videoId)
          if (callback) callback()
        })
        .catch(onError)
        .finally(() => setIsProcessingGif(false))
    },
    [setGifId, onError, text],
  )

  const upload = () => {
    setUploading(true)
    fetch('/uploadGIF', {
      method: 'POST',
      body: JSON.stringify({ filename: gifId }),
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then(() => history.push('/home'))
      .catch(onError)
  }

  const onStopCapture = (blob) => {
    if (!blob) return
    const formData = new FormData()
    formData.append('video', blob)
    fetch('/uploadBlob', {
      method: 'POST',
      body: formData,
    })
      .then((res) => res.ok && res.json())
      .then((response) => {
        if (!response) {
          throw Error
        }
        const { filename } = response
        const id = filename.replace('.webm', '')
        createGIF(id)
      })
      .catch(onError)
  }

  const downloadGif = async () => {
    const res = await fetch(`/download?filename=${gifId}`)
    const fileBlob = await res.blob()
    download(fileBlob, `${gifId}.gif`)
  }

  const handleText = (input) => {
    if (input.length === 30) {
      setTextLimitError('Caption must have a maximum limit of 30 characters.')
    } else {
      setText(input)
      setTextLimitError('')
    }
  }

  const header = (
    <>
      <h1>Create Your Own GIF</h1>
      <Link to="/" className="gif-button-2">
        Cancel
        <Icon name="close" />
      </Link>
    </>
  )

  const isPrerecordingPhase = [PHASE_START, PHASE_COUNTDOWN].includes(phase)
  const isPostRecordingPhase = !isPrerecordingPhase && phase !== PHASE_RECORDING

  const warningMap = {
    [WARNING_GENERIC]: <GenericWarning retry={retry} />,
    [WARNING_BROWSER]: <BrowserWarning />,
  }
  const webCamCompo = recodingInput ? (
    <Webcam
      className="gif-video"
      onError={() => setWarning(WARNING_GENERIC)}
      onCaptureReady={() => setIsWebcamReady(true)}
      recordingInput={recodingInput}
      onStopCapture={onStopCapture}
      isPlaying={phase === PHASE_RECORDING}
      cameraInput={recodingInput}
    />
  ) : (
    <img className="gif-video" src={noCameraImgSrc} alt="" />
  )

  return (
    <Page
      className="gif-create"
      header={header}
      headerClassName="gif-create-header"
    >
      {warning ? (
        warningMap[warning]
      ) : (
        <div className="gif-create-content column">
          <div className="gif-image-container">
            {gifId ? (
              <img
                className="gif-video"
                src={`/img?filename=${gifId}&reload=${phase === PHASE_END}`}
                alt="Your GIF"
              />
            ) : (
              webCamCompo
            )}
          </div>
          <div className="container">
            <Select
              isDisabled={webCamDenied}
              placeholder={webCamSelectPlaceHolder}
              options={webCamOptions}
              onChange={setRecordingInput}
            />
          </div>
          {isPrerecordingPhase && (
            <Countdown
              isPlaying={phase === PHASE_COUNTDOWN}
              onFinish={() => setPhase(PHASE_RECORDING)}
            />
          )}
          {phase === PHASE_RECORDING && (
            <Countdown isPlaying onFinish={() => setPhase(PHASE_TEXT)} danger />
          )}
          {!isPostRecordingPhase && (
            <Button
              onClick={() => setPhase(PHASE_COUNTDOWN)}
              noClick={phase !== PHASE_START}
              grey={phase === PHASE_COUNTDOWN}
              red={phase === PHASE_RECORDING}
              icon={phase === PHASE_START ? 'play' : 'camera'}
              disabled={!isWebcamReady}
            >
              {phase === PHASE_START && 'Start Recording'}
              {phase === PHASE_COUNTDOWN && 'Get Ready...'}
              {!isPrerecordingPhase && 'Recording...'}
            </Button>
          )}
          {phase === PHASE_TEXT && (
            <>
              {textLimitError && (
                <p className="text-limit-error">{textLimitError}</p>
              )}
              <textarea
                placeholder="Add a caption to your GIF! (maximum 30 characters)"
                onChange={(e) => handleText(e.target.value)}
                value={text}
              />
              <div className="gif-button-group">
                <Button
                  disabled={isProcessingGif}
                  onClick={() => setPhase(PHASE_END)}
                  secondary
                  grey
                >
                  Skip
                </Button>
                <Button
                  disabled={text === '' || isProcessingGif}
                  onClick={() => createGIF(gifId, () => setPhase(PHASE_END))}
                >
                  Save Caption
                </Button>
              </div>
            </>
          )}
          {phase === PHASE_END && (
            <>
              <div className="gif-button-group">
                <Button
                  icon="download"
                  onClick={downloadGif}
                  disabled={isUploading || isProcessingGif}
                  secondary
                  grey
                >
                  Download
                </Button>
                <Button
                  icon="undo"
                  onClick={retry}
                  disabled={isUploading}
                  secondary
                  red
                >
                  Retry
                </Button>
              </div>
              <Button
                disabled={isProcessingGif}
                icon="share"
                onClick={upload}
                noClick={isUploading}
              >
                {isUploading ? 'Uploading...' : 'Share With Conference'}
              </Button>
            </>
          )}
        </div>
      )}
    </Page>
  )
}

export default Create
