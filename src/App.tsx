import { useEffect, useCallback } from 'react';
import { useChatStore } from './lib/stores/chat-store';
import { useMessageFlow, useConnectionStatus } from './lib/hooks/useMessageFlow';
import { DevicePanel } from './components/Chat/DevicePanel';
import { ChatWindow } from './components/Chat/ChatWindow';
import './App.css';

function App() {
  const {
    isConnected,
    isConnecting,
    selectedDevice,
    selectDevice,
    devices,
    pairedDevices,
    messages,
    sendMessage,
    setConnected,
  } = useChatStore();

  const { connect, disconnect } = useMessageFlow();
  const { status, statusText } = useConnectionStatus();

  // Handle device selection with auto-connect
  const handleSelectDevice = useCallback(
    (device: typeof selectedDevice) => {
      if (selectedDevice) {
        disconnect();
      }

      selectDevice(device);

      if (device) {
        connect(device);
      }
    },
    [selectedDevice, selectDevice, connect, disconnect]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>ExoMind</h1>
        <div className="connection-status">
          <span
            className={`status ${isConnected ? 'connected' : 'disconnected'}`}
          >
            {isConnecting ? '连接中...' : isConnected ? '已连接' : '未连接'}
          </span>
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <DevicePanel
            devices={devices}
            pairedDevices={pairedDevices}
            selectedDevice={selectedDevice}
            onSelectDevice={handleSelectDevice}
          />
        </aside>

        <section className="chat-area">
          <ChatWindow
            messages={messages}
            selectedDevice={selectedDevice}
            isConnected={isConnected}
            isConnecting={isConnecting}
            onSend={sendMessage}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
