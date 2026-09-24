import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { buildPanel } from './data/panel';
import { useDocuments } from './hooks/useDocuments';
import { useCamera } from './hooks/useMedia';
import { exitFullscreen } from './hooks/useProctoring';
import SetupScreen from './components/SetupScreen';
import WaitingRoom from './components/WaitingRoom';
import InterviewRoom from './components/InterviewRoom';
import ReportScreen from './components/ReportScreen';

const initialSetup = () => ({
  company: '',
  role: '',
  candidateName: '',
  type: 'mixed',
  difficulty: 'medium',
  length: 10,
  panel: buildPanel('mixed', 2),
  proctored: true, // real interview conditions: camera on, full screen, tab switches and pasting noted
});

export default function App() {
  const [screen, setScreen] = useState('setup'); // setup | waiting | interview | report
  const [setup, setSetup] = useState(initialSetup);
  const [interview, setInterview] = useState(null);
  const [report, setReport] = useState(null);
  const [health, setHealth] = useState(null);
  const { docs, analyze, clear, ready } = useDocuments();
  // One camera stream for the waiting room and the interview, so the browser doesn't ask twice.
  const camera = useCamera();

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => window.scrollTo(0, 0), [screen]);

  const startInterview = useCallback((state) => {
    setInterview(state);
    setScreen('interview');
  }, []);

  const finish = useCallback((result) => {
    camera.stop();
    exitFullscreen();
    setReport(result);
    setScreen('report');
  }, [camera.stop]);

  function backToSetup() {
    camera.stop();
    setScreen('setup');
  }

  function restart() {
    camera.stop();
    setInterview(null);
    setReport(null);
    setScreen('setup');
  }

  if (screen === 'waiting') {
    return <WaitingRoom setup={setup} docs={docs} ready={ready} camera={camera} onReady={startInterview} onBack={backToSetup} />;
  }
  if (screen === 'interview') {
    return <InterviewRoom initialState={interview} setup={setup} health={health} camera={camera} onFinished={finish} />;
  }
  if (screen === 'report') {
    return <ReportScreen report={report} onRestart={restart} />;
  }
  return (
    <SetupScreen
      setup={setup}
      setSetup={setSetup}
      docs={docs}
      onAnalyze={analyze}
      onClear={clear}
      health={health}
      onStart={() => setScreen('waiting')}
    />
  );
}
