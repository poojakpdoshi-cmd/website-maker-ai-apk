type Props = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  description: string;
  descriptionId: string;
  chat?: boolean;
};

export default function ThinkMaxControl({
  enabled,
  onChange,
  disabled = false,
  description,
  descriptionId,
  chat = false
}: Props) {
  return (
    <div
      className={
        chat
          ? 'thinkmax-control thinkmax-chat-control'
          : 'thinkmax-control'
      }
    >
      <span className="thinkmax-copy">
        <strong>ThinkMax</strong>
        <small id={descriptionId}>{description}</small>
      </span>

      <button
        type="button"
        className="thinkmax-switch"
        role="switch"
        aria-checked={enabled}
        aria-describedby={descriptionId}
        aria-label="ThinkMax"
        disabled={disabled}
        onClick={() => onChange(!enabled)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
