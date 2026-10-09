import { useEffect, useRef } from 'react';
import { AlertTriangle, Headphones, Info, Mic, MicOff, RefreshCw, VideoOff } from 'lucide-react';
import { Button, Portrait, Spinner } from './ui';

const STATUS = {
  idle: { label: 'Ready', tone: 'text-white/70' },
  speaking: { label: 'Speaking', tone: 'text-accent' },
  listening: { label: 'Listening', tone: 'text-good' },
  thinking: { label: 'Considering your answer', tone: 'text-white/80' },
  transition: { label: 'Preparing audio', tone: 'text-white/70' },
};

function StatusPill({ state }) {
  const status = STATUS[state] || STATUS.idle;
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-black/70 px-2.5 py-1.5 text-[11px] font-medium text-white">
      {state === 'speaking' ? <span className={`voice-bars flex h-3.5 items-center gap-[3px] ${status.tone}`} aria-hidden><span /><span /><span /><span /></span>
        : state === 'listening' ? <Headphones className={`size-3.5 ${status.tone}`} aria-hidden />
          : state === 'thinking' || state === 'transition' ? <Spinner className={`size-3.5 ${status.tone}`} />
            : <span className={`size-1.5 rounded-full bg-current ${status.tone}`} aria-hidden />}
      {status.label}
    </span>
  );
}

// Portraits remain still. Speaking cues reflect speech synthesis events, not generated video.
export function InterviewerTile({ person, state = 'idle', size = 'large', muted = false }) {
  const large = size === 'large';
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-surface transition-colors duration-200 ${state === 'speaking' ? 'border-accent' : 'border-line'} ${large ? 'h-full' : 'aspect-video w-48 shrink-0 lg:w-full'}`}>
      <Portrait avatar={person.avatar} className={`absolute inset-0 size-full ${large ? '[&>img]:object-contain' : '[&>img]:object-center'}`} initialsClassName={large ? 'text-6xl' : 'text-xl'} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" aria-hidden />
      <div className="absolute left-3 top-3"><StatusPill state={state} /></div>
      {large && <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1.5 text-[10px] text-white/80" title="The interviewer uses a portrait and browser speech synthesis. This is not a video feed."><Info className="size-3" aria-hidden /><span>{muted ? 'Audio muted' : 'Photo avatar · Synthetic voice'}</span></span>}
      <div className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 ${large ? 'p-5' : 'p-3'}`}>
        <div><p className={`font-semibold text-white ${large ? 'text-lg' : 'text-sm'}`}>{person.name}</p><p className={`mt-0.5 text-white/75 ${large ? 'text-sm' : 'text-xs'}`}>{person.title}</p></div>
        {large && <span className="hidden rounded border border-white/20 px-2 py-1 text-[10px] text-white/75 sm:inline">AI interviewer</span>}
      </div>
    </div>
  );
}

const FACE_CHIP = {
  loading: { label: 'Starting face checks', warn: false },
  no_face: { label: 'Face not visible', warn: true },
  looking_away: { label: 'Head turned away', warn: true },
  multiple_faces: { label: 'Multiple faces visible', warn: true },
  too_far: { label: 'Move closer to the camera', warn: true },
  excessive_movement: { label: 'Frequent head movement', warn: true },
  no_camera: { label: 'Camera unavailable', warn: true },
  unavailable: { label: 'Face checks unavailable', warn: true },
};

export function CandidateTile({ stream, listening, name, cameraError, cameraStatus, videoRef, faceStatus, microphoneLevel = 0, microphoneStatus, onRetry }) {
  const ownRef = useRef(null);
  const video = videoRef || ownRef;
  useEffect(() => {
    const element = video.current;
    if (element) element.srcObject = stream || null;
    return () => { if (element) element.srcObject = null; };
  }, [stream, video]);
  const chip = faceStatus && FACE_CHIP[faceStatus];
  const micSpeaking = listening && microphoneStatus === 'ready' && microphoneLevel > 0.045;
  const audioLevel = Math.min(1, Math.max(0, microphoneLevel));
  return (
    <div className={`relative aspect-video w-full shrink-0 overflow-hidden rounded-xl border bg-raised ${micSpeaking ? 'border-good' : 'border-line'}`}>
      {stream ? <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" /> : (
        <div className="grid size-full place-items-center p-3"><div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-line text-base font-semibold text-ink-soft">{(name || 'You').slice(0, 1).toUpperCase()}</span>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted"><VideoOff className="size-3.5 shrink-0" aria-hidden />{cameraStatus === 'requesting' ? 'Waiting for camera permission' : cameraError || 'Camera off'}</p>
          {onRetry && cameraStatus !== 'requesting' && <Button size="sm" variant="ghost" className="mt-1" onClick={onRetry}><RefreshCw className="size-3" />Enable camera</Button>}
        </div></div>
      )}
      {stream && <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/75 to-transparent" aria-hidden />}
      {chip && stream && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[10px] font-medium text-white">{chip.warn && <AlertTriangle className="size-3 text-warning" aria-hidden />}{chip.label}</span>}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/45 px-3 py-2 text-white">
        <span className="truncate text-xs font-medium">{name || 'You'} <span className="font-normal text-white/65">(you)</span></span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-white/80" title={listening ? microphoneStatus === 'ready' ? 'Actual microphone activity' : 'Voice capture is active; audio level is unavailable' : 'Microphone is paused'}>
          {listening ? <Mic className={`size-3.5 ${micSpeaking ? 'text-good' : 'text-white/75'}`} aria-hidden /> : <MicOff className="size-3.5" aria-hidden />}
          {listening && microphoneStatus === 'ready' && <span className="flex h-3 items-center gap-[2px]" aria-hidden>{[0.6, 1, 0.8].map((scale, index) => <span key={index} className="w-[2px] rounded-sm bg-good transition-[height] duration-75" style={{ height: `${Math.max(2, audioLevel * 16 * scale)}px` }} />)}</span>}
          {micSpeaking ? 'Speaking' : listening ? 'Mic active' : 'Mic paused'}
        </span>
      </div>
    </div>
  );
}
