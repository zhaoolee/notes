import {
  useEffect,
  useState,
  type FormEvent,
  type HTMLInputAutoCompleteAttribute,
} from "react";

interface ChangePasswordDialogProps {
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  onClose: () => void;
}

interface PasswordInputProps {
  autoComplete: HTMLInputAutoCompleteAttribute;
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}

function PasswordInput({
  autoComplete,
  label,
  name,
  onChange,
  value,
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="change-password-field">
      <label htmlFor={name}>{label}</label>
      <span className="change-password-input-wrap">
        <input
          id={name}
          type={isVisible ? "text" : "password"}
          name={name}
          autoComplete={autoComplete}
          minLength={name === "currentPassword" ? undefined : 8}
          maxLength={128}
          value={value}
          required
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="change-password-toggle"
          aria-label={`${isVisible ? "隐藏" : "显示"}${label}`}
          aria-pressed={isVisible}
          onClick={() => setIsVisible((visible) => !visible)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8 6-3.5 6-9.8 6-9.8-6-9.8-6Z" />
            <circle cx="12" cy="12" r="2.8" />
            {isVisible ? null : <path d="m4 4 16 16" />}
          </svg>
        </button>
      </span>
    </div>
  );
}

export function ChangePasswordDialog({
  changePassword,
  onClose,
}: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      setError("新密码长度应为 8–128 个字符。");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsComplete(true);
    } catch (changeError) {
      setError(
        changeError instanceof Error ? changeError.message : "修改密码失败。",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="change-password-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="change-password-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
      >
        <button
          type="button"
          className="change-password-close"
          aria-label="关闭修改密码窗口"
          onClick={onClose}
        >
          ×
        </button>

        <h2 id="change-password-title">修改密码</h2>

        {isComplete ? (
          <div className="change-password-success" role="status">
            <strong>密码修改成功</strong>
            <p>新密码已生效，其他设备上的旧登录会话已失效。</p>
            <button type="button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : (
          <form className="change-password-form" onSubmit={handleSubmit}>
            <p>修改后，其他设备需要使用新密码重新登录。</p>
            <PasswordInput
              autoComplete="current-password"
              label="当前密码"
              name="currentPassword"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <PasswordInput
              autoComplete="new-password"
              label="新密码"
              name="newPassword"
              value={newPassword}
              onChange={setNewPassword}
            />
            <PasswordInput
              autoComplete="new-password"
              label="确认新密码"
              name="confirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />

            {error ? (
              <p className="change-password-error" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="change-password-submit"
              disabled={
                isSubmitting ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
            >
              {isSubmitting ? "正在修改..." : "确认修改"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
