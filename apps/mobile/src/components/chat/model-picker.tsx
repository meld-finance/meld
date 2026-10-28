import type { ChatModelOption } from '@meld/shared';

import { Dropdown } from '@/components/dropdown';
import { useChatModel } from '@/lib/chat-model';

/** Picks the model Ask Meld answers with; hidden when there's only one. */
export function ModelPicker({ openUp }: { openUp?: boolean }) {
  const { models, current, choose } = useChatModel();
  if (models.length < 2 || !current) return null;
  return (
    <Dropdown
      accessibilityLabel="Model"
      openUp={openUp}
      options={models.map((m) => ({ value: m.id, label: m.note ? `${m.label} · ${m.note}` : m.label }))}
      value={current.id}
      onChange={choose}
    />
  );
}

/** Where questions go with this model. */
export function privacyNote(model: ChatModelOption | null) {
  if (model?.local) return 'Answered by a model on this computer; your data stays here.';
  if (model?.provider === 'ollama') return 'Questions and the data needed to answer them are sent to your Ollama server.';
  return 'Questions and the data needed to answer them are sent to Anthropic.';
}
