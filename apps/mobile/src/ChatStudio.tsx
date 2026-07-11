import { ChangeEvent, FormEvent, useRef, useState } from 'react';

type ChatResult = {
  projectName: string;
} | null;

type ChatStudioProps = {
  busy: boolean;
  onGenerate: (prompt: string) => Promise<ChatResult>;
  onOpenPreview: () => void;
};

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

const starterPrompts = [
  'Build a premium ecommerce website',
  'Create a modern portfolio website',
  'Make a restaurant website with WhatsApp',
  'Design a landing page for my startup'
];

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ChatStudio({
  busy,
  onGenerate,
  onOpenPreview
}: ChatStudioProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState<{
    name: string;
    dataUrl: string;
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        'Tell me what you want to build. I will send the request to the WebForge orchestrator, Gemini, validators and build system.'
    }
  ]);

  function chooseStarter(value: string) {
    setDraft(value);
  }

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: 'assistant',
          text: 'Please choose a valid image file.'
        }
      ]);
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: 'assistant',
          text: 'The image must be smaller than 8 MB.'
        }
      ]);
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setImage({
        name: file.name,
        dataUrl: String(reader.result || '')
      });
    };

    reader.readAsDataURL(file);
    event.target.value = '';
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();

    const request = draft.trim();

    if (busy || request.length < 20) return;

    setMessages((current) => [
      ...current,
      {
        id: messageId(),
        role: 'user',
        text: image ? `${request}\n\nAttached image: ${image.name}` : request
      }
    ]);

    setDraft('');

    const attachedImage = image;
    setImage(null);

    if (attachedImage) {
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: 'assistant',
          text:
            'The image attachment UI is ready. Visual understanding will be connected to the backend in the next upgrade; this build will use your written instructions.'
        }
      ]);
    }

    const generated = await onGenerate(request);

    setMessages((current) => [
      ...current,
      {
        id: messageId(),
        role: 'assistant',
        text: generated
          ? `${generated.projectName} has been generated and validated. Open Preview to review or edit it.`
          : 'The website could not be generated. Check the error shown above and try again.'
      }
    ]);
  }

  return (
    <section className="chat-studio">
      <header className="chat-studio-topbar">
        <div>
          <p className="eyebrow">WEBFORGE CHAT</p>
          <h2>What are we building?</h2>
        </div>

        <span className="chat-model-badge">
          Gemini + Orchestrator
        </span>
      </header>

      <div className="chat-thread" aria-live="polite">
        {messages.map((message) => (
          <article
            key={message.id}
            className={`chat-message ${message.role}`}
          >
            <div className="chat-avatar">
              {message.role === 'assistant' ? 'W' : 'You'}
            </div>

            <div className="chat-message-content">
              <strong>
                {message.role === 'assistant' ? 'WebForge' : 'You'}
              </strong>
              <p>{message.text}</p>
            </div>
          </article>
        ))}

        {busy && (
          <article className="chat-message assistant">
            <div className="chat-avatar">W</div>
            <div className="chat-message-content">
              <strong>WebForge</strong>
              <p className="chat-thinking">
                Planning, coding and validating your website…
              </p>
            </div>
          </article>
        )}
      </div>

      {messages.length === 1 && (
        <div className="chat-starters">
          {starterPrompts.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => chooseStarter(starter)}
            >
              {starter}
            </button>
          ))}
        </div>
      )}

      <form className="chat-composer" onSubmit={submitMessage}>
        {image && (
          <div className="chat-image-preview">
            <img src={image.dataUrl} alt="" />
            <span>{image.name}</span>
            <button
              type="button"
              onClick={() => setImage(null)}
              aria-label="Remove image"
            >
              ×
            </button>
          </div>
        )}

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={6000}
          placeholder="Describe the website, feature or change you need…"
          disabled={busy}
        />

        <div className="chat-composer-actions">
          <div>
            <button
              type="button"
              className="chat-attach-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              + Image
            </button>

            <input
              ref={fileInputRef}
              className="chat-file-input"
              type="file"
              accept="image/*"
              onChange={handleImage}
            />
          </div>

          <span>{draft.length}/6000</span>

          <button
            type="submit"
            className="chat-send-button"
            disabled={busy || draft.trim().length < 20}
          >
            {busy ? 'Building…' : 'Send'}
          </button>
        </div>
      </form>

      <button
        type="button"
        className="chat-preview-button"
        onClick={onOpenPreview}
      >
        Open latest preview
      </button>
    </section>
  );
}
