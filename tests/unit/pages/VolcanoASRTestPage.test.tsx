import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { VolcanoASRTestPage } from '@/pages/VolcanoASRTestPage';

describe('VolcanoASRTestPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders official mode and resource configuration menus', () => {
    render(<VolcanoASRTestPage />);

    expect(screen.getByText('识别模式')).toBeInTheDocument();
    expect(screen.getByText('资源模型')).toBeInTheDocument();
    expect(screen.getByText('识别语言')).toBeInTheDocument();
    expect(screen.getByText(/model_name.*bigmodel/i)).toBeInTheDocument();
  });
});
