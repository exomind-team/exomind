import { useCallback, useEffect } from 'react';
import { useChatStore } from './lib/stores/chat-store';
import { useMessageFlow } from './lib/hooks/useMessageFlow';
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
    network,
  } = useChatStore();

  const { connect, disconnect } = useMessageFlow();

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
        <div className="connection-status" data-testid="connection-status">
          <span
            className={`status ${isConnected ? 'connected' : 'disconnected'}`}
          >
            {isConnecting ? '连接中...' : isConnected ? '已连接' : '离线模式'}
          </span>
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar" data-testid="device-panel">
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
            network={network}
            onSend={sendMessage}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
