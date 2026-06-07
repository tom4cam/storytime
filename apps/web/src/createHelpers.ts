import type { YesNoNode } from './components/HelpYesNo';
import type { StringKey } from './i18n/strings/en';

export const HERO_TREE: YesNoNode = {
  prompt: { en: 'Is your hero an animal?', sv: 'Är hjälten ett djur?', bg: 'Is your hero an animal?', es: 'Is your hero an animal?', fr: 'Is your hero an animal?', it: 'Il tuo eroe è un animale?' },
  yes: {
    prompt: { en: 'A small fuzzy one?', sv: 'En liten luddig?', bg: 'A small fuzzy one?', es: 'A small fuzzy one?', fr: 'A small fuzzy one?', it: 'Uno piccolo e peloso?' },
    yes: { answer: { en: 'a small fuzzy bunny named Pip', sv: 'en liten luddig kanin som heter Pip', bg: 'a small fuzzy bunny named Pip', es: 'a small fuzzy bunny named Pip', fr: 'a small fuzzy bunny named Pip', it: 'un coniglietto morbido di nome Pip' } },
    no:  { answer: { en: 'a brave little dragon named Spark', sv: 'en modig liten drake som heter Gnista', bg: 'a brave little dragon named Spark', es: 'a brave little dragon named Spark', fr: 'a brave little dragon named Spark', it: 'un piccolo drago coraggioso di nome Scintilla' } },
  },
  no: {
    prompt: { en: 'A brave kid?', sv: 'Ett modigt barn?', bg: 'A brave kid?', es: 'A brave kid?', fr: 'A brave kid?', it: 'Un bambino coraggioso?' },
    yes: { answer: { en: 'a brave kid named Max', sv: 'ett modigt barn som heter Max', bg: 'a brave kid named Max', es: 'a brave kid named Max', fr: 'a brave kid named Max', it: 'un bambino coraggioso di nome Max' } },
    no:  { answer: { en: 'a kind robot named Beep', sv: 'en snäll robot som heter Pip', bg: 'a kind robot named Beep', es: 'a kind robot named Beep', fr: 'a kind robot named Beep', it: 'un robot gentile di nome Bip' } },
  },
};

export const SETTING_TREE: YesNoNode = {
  prompt: { en: 'Is it outside?', sv: 'Är det utomhus?', bg: 'Is it outside?', es: 'Is it outside?', fr: 'Is it outside?', it: 'Si svolge all’aperto?' },
  yes: {
    prompt: { en: 'In a forest?', sv: 'I en skog?', bg: 'In a forest?', es: 'In a forest?', fr: 'In a forest?', it: 'In una foresta?' },
    yes: { answer: { en: 'in a magic forest with tall trees', sv: 'i en magisk skog med höga träd', bg: 'in a magic forest with tall trees', es: 'in a magic forest with tall trees', fr: 'in a magic forest with tall trees', it: 'in una foresta magica con alberi altissimi' } },
    no:  { answer: { en: 'on a sunny beach by the sea', sv: 'på en solig strand vid havet', bg: 'on a sunny beach by the sea', es: 'on a sunny beach by the sea', fr: 'on a sunny beach by the sea', it: 'su una spiaggia soleggiata in riva al mare' } },
  },
  no: {
    prompt: { en: 'In a house?', sv: 'I ett hus?', bg: 'In a house?', es: 'In a house?', fr: 'In a house?', it: 'In una casa?' },
    yes: { answer: { en: 'in a cozy little house full of books', sv: 'i ett mysigt litet hus fullt av böcker', bg: 'in a cozy little house full of books', es: 'in a cozy little house full of books', fr: 'in a cozy little house full of books', it: 'in una casetta accogliente piena di libri' } },
    no:  { answer: { en: 'in a spaceship far above the clouds', sv: 'i ett rymdskepp högt över molnen', bg: 'in a spaceship far above the clouds', es: 'in a spaceship far above the clouds', fr: 'in a spaceship far above the clouds', it: 'su un’astronave ben sopra le nuvole' } },
  },
};

export const GOAL_TREE: YesNoNode = {
  prompt: { en: 'Are they looking for something?', sv: 'Letar de efter något?', bg: 'Are they looking for something?', es: 'Are they looking for something?', fr: 'Are they looking for something?', it: 'Stanno cercando qualcosa?' },
  yes: {
    prompt: { en: 'Something to eat?', sv: 'Något att äta?', bg: 'Something to eat?', es: 'Something to eat?', fr: 'Something to eat?', it: 'Qualcosa da mangiare?' },
    yes: { answer: { en: 'to find the worlds biggest cookie', sv: 'att hitta världens största kaka', bg: 'to find the worlds biggest cookie', es: 'to find the worlds biggest cookie', fr: 'to find the worlds biggest cookie', it: 'trovare il biscotto più grande del mondo' } },
    no:  { answer: { en: 'to find a hidden treasure', sv: 'att hitta en gömd skatt', bg: 'to find a hidden treasure', es: 'to find a hidden treasure', fr: 'to find a hidden treasure', it: 'trovare un tesoro nascosto' } },
  },
  no: {
    prompt: { en: 'Are they helping someone?', sv: 'Hjälper de någon?', bg: 'Are they helping someone?', es: 'Are they helping someone?', fr: 'Are they helping someone?', it: 'Stanno aiutando qualcuno?' },
    yes: { answer: { en: 'to help a lost friend get home', sv: 'att hjälpa en vilsen vän hem', bg: 'to help a lost friend get home', es: 'to help a lost friend get home', fr: 'to help a lost friend get home', it: 'aiutare un amico smarrito a tornare a casa' } },
    no:  { answer: { en: 'to learn a new song', sv: 'att lära sig en ny sång', bg: 'to learn a new song', es: 'to learn a new song', fr: 'to learn a new song', it: 'imparare una nuova canzone' } },
  },
};

export interface QuestionHelpers {
  simplerKey?: StringKey;
  tree?: YesNoNode;
}

export const QUESTION_HELPERS: Record<string, QuestionHelpers> = {
  hero:    { simplerKey: 'q.hero.simpler',    tree: HERO_TREE },
  setting: { simplerKey: 'q.setting.simpler', tree: SETTING_TREE },
  goal:    { simplerKey: 'q.goal.simpler',    tree: GOAL_TREE },
};
