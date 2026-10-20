import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { buildPanel } from './data/panel';
import { useDocuments } from './hooks/useDocuments';
import { stopSpeaking, useCamera } from './hooks/useMedia';
import { exitFullscreen } from './hooks/useProctoring';
import SetupScreen from './components/SetupScreen';
import WaitingRoom from './components/WaitingRoom';
import InterviewRoom from './components/InterviewRoom';
import ReportScreen from './components/ReportScreen';
import PracticeWorkspace from './components/PracticeWorkspace';

const initialSetup = () => ({
  company: '',
  role: '',
  candidateName: '',
  type: 'mixed',
  difficulty: 'medium',
  length: 10,
  panel: buildPanel('mixed', 2),
  proctored: false, // First-time practice works with typed answers and an optional camera.
});

export default function App() {
  const [screen, setScreen] = useState('setup'); // setup | waiting | interview | report
  const [setup, setSetup] = useState(initialSetup);
  const [interview, setInterview] = useState(null);
  const [report, setReport] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [health, setHealth] = useState(null);
  const [practiceTab, setPracticeTab] = useState('questions');
  const [practiceReturn, setPracticeReturn] = useState('setup');
  const { docs, analyze, clear, ready } = useDocuments();
  // One camera stream for the waiting room and the interview, so the browser doesn't ask twice.
  const camera = useCamera();

  useEffect(() => {
    const controller = new AbortController();
    api
      .health({ signal: controller.signal })
      .then(setHealth)
      .catch(() => {
        if (!controller.signal.aborted) setHealth(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    const labels = {
      setup: 'Set up your interview',
      waiting: 'Device check',
      interview: 'Interview in progress',
      report: 'Interview report',
      practice: 'Practice workspace',
    };
    document.title = `${labels[screen]} · Interview Room`;
    const heading = document.querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }, [screen]);

  const startInterview = useCallback((state) => {
    setInterview(state);
    setScreen('interview');
  }, []);

  const finish = useCallback(
    (result) => {
      camera.stop();
      stopSpeaking();
      exitFullscreen();
      setReport(result);
      setReportId(crypto.randomUUID());
      setScreen('report');
    },
    [camera.stop],
  );

  function backToSetup() {
    camera.stop();
    stopSpeaking();
    exitFullscreen();
    setScreen('setup');
  }

  function restart() {
    camera.stop();
    stopSpeaking();
    exitFullscreen();
    setInterview(null);
    setReport(null);
    setScreen('setup');
  }

  function openPractice(tab = 'questions') {
    setPracticeTab(tab);
    setPracticeReturn(screen === 'report' ? 'report' : 'setup');
    setScreen('practice');
  }

  if (screen === 'practice') {
    return <PracticeWorkspace initialTab={practiceTab} backLabel={practiceReturn === 'report' ? 'Back to report' : 'Interview setup'} onBack={() => setScreen(practiceReturn)} />;
  }

  if (screen === 'waiting') {
    return (
      <WaitingRoom
        setup={setup}
        docs={docs}
        ready={ready}
        camera={camera}
        onReady={startInterview}
        onBack={backToSetup}
      />
    );
  }
  if (screen === 'interview') {
    return (
      <InterviewRoom
        initialState={interview}
        setup={setup}
        health={health}
        camera={camera}
        onFinished={finish}
      />
    );
  }
  if (screen === 'report') {
    return <ReportScreen report={report} reportId={reportId} onRestart={restart} onOpenHistory={() => openPractice('history')} />;
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
      onOpenPractice={openPractice}
    />
  );
}
