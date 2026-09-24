import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { buildPanel } from './data/panel';
import { useDocuments } from './hooks/useDocuments';
import SetupScreen from './components/SetupScreen';
import PreparingScreen from './components/PreparingScreen';
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
});

export default function App() {
  const [screen, setScreen] = useState('setup'); // setup | preparing | interview | report
  const [setup, setSetup] = useState(initialSetup);
  const [interview, setInterview] = useState(null);
  const [report, setReport] = useState(null);
  const [health, setHealth] = useState(null);
  const { docs, analyze, clear, ready } = useDocuments();

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => window.scrollTo(0, 0), [screen]);

  const startInterview = useCallback((state) => {
    setInterview(state);
    setScreen('interview');
  }, []);

  const finish = useCallback((result) => {
    setReport(result);
    setScreen('report');
  }, []);

  function restart() {
    setInterview(null);
    setReport(null);
    setScreen('setup');
  }

  if (screen === 'preparing') {
    return <PreparingScreen setup={setup} docs={docs} ready={ready} onReady={startInterview} onBack={() => setScreen('setup')} />;
  }
  if (screen === 'interview') {
    return <InterviewRoom initialState={interview} setup={setup} health={health} onFinished={finish} />;
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
      onStart={() => setScreen('preparing')}
    />
  );
}
