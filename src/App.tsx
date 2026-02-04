import { useEffect } from 'react';
import { useChatStore } from './lib/stores/chat-store';
import { DevicePanel } from './components/Chat/DevicePanel';
import { ChatWindow } from './components/Chat/ChatWindow';
import './App.css';

function App() {
  const {
    isConnected,
    selectedDevice,
    selectDevice,
    devices,
    pairedDevices,
  } = useChatStore();

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>ExoMind</h1>
        <div className="connection-status">
          {isConnected ? (
            <span className="status connected">已连接</span>
          ) : (
            <span className="status disconnected">未连接</span>
          )}
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <DevicePanel
            devices={devices}
            pairedDevices={pairedDevices}
            selectedDevice={selectedDevice}
            onSelectDevice={selectDevice}
          />
        </aside>

        <section className="chat-area">
          <ChatWindow />
        </section>
      </main>
    </div>
  );
}

export default App;
