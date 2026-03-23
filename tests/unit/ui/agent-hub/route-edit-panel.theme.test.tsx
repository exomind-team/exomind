import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouteEditPanel } from '@/components/RouteEditPanel';

describe('route edit panel theme（路由编辑面板主题）', () => {
  it('uses semantic theme tokens for text inputs in light mode（亮色模式下输入框应接入全局主题 token）', () => {
    render(
      <RouteEditPanel
        route={null}
        availableTopics={['voice.input.transcript']}
        availableAgents={[{ id: 'classifier', name: 'Classifier Agent' }]}
        availableActors={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');
    const topicInput = comboboxes[0];
    const targetTypeSelect = comboboxes[1];

    expect(topicInput.className).toContain('bg-card');
    expect(topicInput.className).toContain('text-foreground');
    expect(topicInput.className).toContain('border-border-card');
    expect(targetTypeSelect.className).toContain('bg-card');
    expect(targetTypeSelect.className).toContain('text-foreground');
    expect(targetTypeSelect.className).toContain('border-border-card');
  });

  it('uses semantic theme tokens for target ref input after switching to remote（切换到 remote 后目标输入框仍应接入全局主题 token）', () => {
    render(
      <RouteEditPanel
        route={null}
        availableTopics={['voice.input.transcript']}
        availableAgents={[{ id: 'classifier', name: 'Classifier Agent' }]}
        availableActors={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[1]!, { target: { value: 'remote' } });

    const textboxes = screen.getAllByRole('textbox');
    const targetRefInput = textboxes.find((element) => (element as HTMLInputElement).placeholder === 'e.g. ui');

    expect(targetRefInput?.className).toContain('bg-card');
    expect(targetRefInput?.className).toContain('text-foreground');
    expect(targetRefInput?.className).toContain('border-border-card');
  });
});
