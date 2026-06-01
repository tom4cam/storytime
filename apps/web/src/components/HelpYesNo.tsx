import { useState } from 'react';
// Note: Lang here is the narrow app-UI Lang (en/sv/bg/es/fr) from i18n,
// NOT the wider story-content Lang from types.ts. HelpYesNo prompts are
// shown in the UI language, which is governed by the settings cog (en/sv).
// Callers pass uiLang, never storyLang.
import type { Lang } from '../i18n';
import { useT } from '../i18n';

export type YesNoNode =
  | { prompt: Record<Lang, string>; yes: YesNoNode; no: YesNoNode }
  | { answer: Record<Lang, string> };

interface Props {
  tree: YesNoNode;
  language: Lang;
  onAnswer: (text: string) => void;
  onCancel: () => void;
}

function isLeaf(n: YesNoNode): n is { answer: Record<Lang, string> } {
  return 'answer' in n;
}

export function HelpYesNo({ tree, language, onAnswer, onCancel }: Props) {
  const t = useT();
  const [node, setNode] = useState<YesNoNode>(tree);

  if (isLeaf(node)) {
    // Defensive: leaves are normally resolved in the click handler. If we
    // ever land here with a leaf, emit and stop rendering.
    onAnswer(node.answer[language]);
    return null;
  }

  const choose = (next: YesNoNode) => {
    if (isLeaf(next)) onAnswer(next.answer[language]);
    else setNode(next);
  };

  return (
    <div className="card help-yesno">
      <div className="question">{node.prompt[language]}</div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn sun" onClick={() => choose(node.yes)}>{t('help.yes')}</button>
        <button type="button" className="btn secondary" onClick={() => choose(node.no)}>{t('help.no')}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>{t('help.cancel')}</button>
      </div>
    </div>
  );
}
