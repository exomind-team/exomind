import { useState, useEffect } from 'react';
import { QrCode, X, Copy, Check as CheckIcon, RefreshCw } from 'lucide-react';
import './PairingModal.css';

interface PairingModalProps {
  onClose: () => void;
  onPair: (code: string) => void;
  mode: 'generate' | 'input';
  pairingCode?: string;
}

export function PairingModal({ onClose, onPair, mode, pairingCode: initialCode }: PairingModalProps) {
  const [pairingCode, setPairingCode] = useState(initialCode || '');
  const [inputCode, setInputCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(300); // 5分钟倒计时

  // 生成配对码时启动倒计时
  useEffect(() => {
    if (mode === 'generate' && !initialCode) {
      // 生成6位随机数字码
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setPairingCode(code);
    }
  }, [mode, initialCode]);

  // 倒计时
  useEffect(() => {
    if (mode === 'generate' && pairingCode) {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [mode, pairingCode]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (mode === 'generate') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <QrCode size={24} className="modal-icon" />
            <h2>配对设备</h2>
            <button onClick={onClose} className="close-btn" aria-label="关闭">
              <X size={24} />
            </button>
          </div>

          <div className="modal-body">
            <p className="instruction">将此配对码输入到另一台设备</p>

            <div className="code-display">
              {pairingCode.split('').map((char, i) => (
                <span key={i} className="code-char">{char}</span>
              ))}
            </div>

            <div className="countdown">
              <RefreshCw size={14} />
              <span>有效期: {formatCountdown(countdown)}</span>
            </div>

            <button onClick={copyCode} className="copy-btn">
              {copied ? (
                <>
                  <CheckIcon size={18} />
                  已复制到剪贴板
                </>
              ) : (
                <>
                  <Copy size={18} />
                  复制配对码
                </>
              )}
            </button>

            <div className="waiting-notice">
              等待对方输入配对码...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <QrCode size={24} className="modal-icon" />
          <h2>输入配对码</h2>
          <button onClick={onClose} className="close-btn" aria-label="关闭">
            <X size={24} />
          </button>
        </div>

        <div className="modal-body">
          <p className="instruction">输入另一台设备显示的 6 位配对码</p>

          <div className="code-input-container">
            {Array(6).fill(0).map((_, i) => (
              <input
                key={i}
                type="text"
                maxLength={1}
                value={inputCode[i] || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value && /^[0-9]$/.test(value)) {
                    const newCode = inputCode.split('');
                    newCode[i] = value;
                    setInputCode(newCode.join(''));
                    // Auto-focus next input
                    const nextInput = e.target.nextSibling as HTMLInputElement;
                    if (nextInput && nextInput.tagName === 'INPUT') {
                      nextInput.focus();
                    }
                  } else if (!value) {
                    // Allow backspace
                    const newCode = inputCode.split('');
                    newCode[i] = '';
                    setInputCode(newCode.join(''));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !inputCode[i] && i > 0) {
                    const prevInput = e.currentTarget.previousSibling as HTMLInputElement;
                    if (prevInput && prevInput.tagName === 'INPUT') {
                      prevInput.focus();
                    }
                  }
                }}
                className="code-char-input"
                inputMode="numeric"
                pattern="[0-9]*"
              />
            ))}
          </div>

          <button
            onClick={() => onPair(inputCode)}
            disabled={inputCode.length !== 6}
            className="confirm-btn"
          >
            确认配对
          </button>
        </div>
      </div>
    </div>
  );
}
