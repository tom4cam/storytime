export const en = {
  // Brand and dedication
  'brand.name': 'storytime',
  'brand.tagline': 'Tell a story. Hear it. Watch it.',
  'dedication.line': "Made with love by Uncle Tom for Brennan and Linnéa's birthdays.",

  // Home page
  'home.heroTitle': 'Make a story. Anything you want.',
  'home.heroBody': 'Pick a hero, pick a place, pick a problem. The story maker will write it, draw it, and read it out loud just for you.',
  'home.heroCta': 'Start a new story',
  'home.recentHeading': 'Recent stories',
  'home.recentLoading': 'Loading recent stories...',
  'home.recentEmpty': 'No stories yet. Tap the big yellow button to make the first one.',
  'home.filterAll': 'All recent',
  'home.filterMine': 'Just mine',

  // Create page chrome
  'create.langStepTitle': 'Pick a language for your story.',
  'create.langStepEn': 'English',
  'create.langStepSv': 'Svenska (Swedish)',
  'create.langStepBg': 'Български (Bulgarian)',
  'create.langStepEs': 'Español (Spanish)',
  'create.langStepFr': 'Français (French)',
  'create.langStepIt': 'Italiano (Italian)',
  'create.langStepMk': 'Македонски (Macedonian)',
  'create.langStepPtBr': 'Português brasileiro (Brazilian Portuguese)',
  'create.langStepPtPt': 'Português de Portugal (European Portuguese)',
  'create.requestLang': 'Request another language',
  'create.hearAgain': 'Hear the question again',
  'create.skipThis': 'Skip this',
  'create.next': 'Next',
  'create.saveAnswer': 'Save answer',
  'create.makeStory': 'Make my story',
  'create.required': 'You need to answer this one.',
  'create.optional': 'This one is optional. Add more if you want, or skip ahead.',
  'create.soFar': 'So far:',
  'create.allSet': 'All set.',
  'create.allSetHint': 'Tap "Make my story" to put it all together.',
  'create.sending': 'Sending it off to the storytellers...',
  'create.typeOrSpeak': 'Please type or speak an answer first.',

  // Question prompts (the create flow's six original questions; SV mirror in sv.ts)
  'q.hero.prompt': 'Who is the hero of your story?',
  'q.hero.spoken': 'Who is the hero of your story? Tell me a name and what they are like.',
  'q.hero.placeholder': 'Example: a brave bunny named Pip who loves cookies',
  'q.setting.prompt': 'Where does the story happen?',
  'q.setting.spoken': 'Where does the story happen?',
  'q.setting.placeholder': 'Example: in a magic forest, or on a pirate ship',
  'q.goal.prompt': 'What does your hero want or need?',
  'q.goal.spoken': 'What does your hero want or need?',
  'q.goal.placeholder': 'Example: to find the world’s biggest pancake',
  'q.friend.prompt': 'Is there a friend or a helper? Who is it?',
  'q.friend.spoken': 'Is there a friend or a helper? Who is it?',
  'q.friend.placeholder': 'Example: a wise old turtle named Sage',
  'q.problem.prompt': 'What problem do they have to solve?',
  'q.problem.spoken': 'What problem do they have to solve?',
  'q.problem.placeholder': 'Example: the bridge to the pancake mountain is broken',
  'q.ending.prompt': 'How should the story end?',
  'q.ending.spoken': 'How should the story end? Happy, silly, or surprising?',
  'q.ending.placeholder': 'Example: happy and silly, with a big pancake party',

  // Story page
  'story.opening': 'Opening the story...',
  'story.notFound': 'Story not found.',
  'story.backHome': 'Back to home',
  'story.makingTitle': 'Making your story...',
  'story.makingHint': 'Writing the words, drawing the pictures, and recording the voice. This takes about a minute. The page will refresh on its own.',
  'story.failedTitle': 'Something went wrong.',
  'story.failedDefault': 'The story could not be made this time.',
  'story.tryNew': 'Try a new one',
  'story.versionPrefix': 'Version',
  'story.savedPrefix': 'saved',
  'story.editLink': 'Edit this story',
  'story.makeAnother': 'Make a new one',
  'story.download': 'Download as PDF',
  'story.delete': 'Delete this story',
  'story.deleteConfirmTitle': 'Delete this story?',
  'story.deleteConfirmBody': "This can't be undone. The story, its versions, pictures, and audio will all be removed.",
  'story.deleteYes': 'Yes, delete it',
  'story.deleteNo': 'Keep it',
  'story.deleteFailed': 'Could not delete the story. Try again.',
  'story.adminBadge': 'Admin',
  'story.adminDeleteVersion': 'Delete this version',
  'story.adminDeleteVersionConfirm': 'Delete v{n}?',
  'story.adminDeleteVersionBody': "This version, its pictures, and its audio will be removed. If it's the latest version, the story will roll back to the previous one.",
  'story.adminForceDelete': 'Force-delete entire story',
  'story.adminForceDeleteConfirm': 'Force-delete this story?',
  'story.adminForceDeleteBody': 'All versions, pictures, and audio for this story will be removed. This bypasses the usual ownership check.',
  'admin.confirmPrompt': 'Type {word} to confirm.',
  'admin.confirmPlaceholder': 'Type the word here',
  'admin.confirmWord': 'DELETE',
  'admin.confirmGo': 'Delete',
  'admin.confirmCancel': 'Cancel',
  'story.listed': 'Listed on home page',
  'story.unlisted': 'Hidden from home page',
  'story.listingFailed': "Couldn't update — try again.",
  'story.share': 'Share',
  'story.shareCopied': 'Link copied!',
  'story.translate': 'Translate',
  'story.translateChoose': 'Translate into:',
  'story.translating': 'Translating...',
  'story.translateError': 'Translation failed — try again.',

  // Edit page
  'edit.loading': 'Loading the story...',
  'edit.notFound': 'Story not found.',
  'edit.sending': 'Sending the changes...',
  'edit.heading': 'Edit story',
  'edit.versionNote': 'Saving will create version {next}.',
  'edit.titleLabel': 'Title',
  'edit.summaryLabel': 'Story and character summary',
  'edit.summaryHint': 'Optional. Use this to keep the look of your characters consistent. Anything you write here is added to every redrawn picture as context, so describe hair color, age, clothes, and anything important. Example: "Bob is a man with short blond hair and a short blond beard, wearing a chef apron. Brennan is a 10-year-old blond boy."',
  'edit.summaryPlaceholder': 'Describe the look of the main characters and the feel of the story...',
  'edit.paragraphLabel': 'Paragraph {n}',
  'edit.regenerateImage': 'Regenerate this picture when I save',
  'edit.cancel': 'Cancel',
  'edit.save': 'Save as new version',
  'edit.saveInPlace': 'Save edits',
  'edit.savingInPlace': 'Saving will update this story in place (no new version).',

  // Not found page
  'notFound.title': 'That page got lost in the woods.',
  'notFound.body': "Let's go back and pick a different path.",

  // Mic / speech
  'mic.start': 'Speak your answer',
  'mic.stop': 'Stop recording',
  'mic.unavailable': 'Voice input is not supported in this browser. You can still type your answer. (Chrome and Edge work best for voice.)',
  'mic.notHeard': 'Sorry, I did not catch that. Please try again.',

  // Navigation
  'nav.back': 'Back',

  // Audio player
  'audio.play': 'Play',
  'audio.pause': 'Pause',
  'audio.replay': 'Play again',

  // Settings cog
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageEn': 'English',
  'settings.languageSv': 'Svenska',
  'settings.languageBg': 'Български',
  'settings.languageEs': 'Español',
  'settings.languageFr': 'Français',
  'settings.slow': 'Speech speed',
  'settings.slowOn': 'Slow',
  'settings.slowOff': 'Normal',
  'settings.close': 'Close',

  // Story-type opener
  'opener.title': 'What kind of story do you want?',
  'opener.spoken': 'What kind of story do you want?',
  'opener.chip.adventure': 'Adventure',
  'opener.chip.silly': 'Silly',
  'opener.chip.animals': 'Animal friends',
  'opener.chip.bedtime': 'Bedtime calm',
  'opener.chip.magic': 'Magic',
  'opener.chip.mystery': 'Mystery',
  'opener.chip.surprise': 'Surprise me',
  'opener.placeholder': 'Or tell me your own idea',

  // Moderation redirect
  'mod.redirectTitle': "Let's pick something different.",
  'mod.redirectBody': 'How about one of these?',

  // Voice picker
  'voice.stepTitle': 'Pick a voice to read your story.',
  'voice.playSample': 'Play sample',
  'voice.next': 'Use this voice',

  // Helpers (per-question)
  'help.simpler': 'Say it simpler',
  'help.original': 'Say it the normal way',
  'help.yesno': 'Help me answer',
  'help.yes': 'Yes',
  'help.no': 'No',
  'help.cancel': 'Never mind',

  // Per-question simpler variants (hero/setting/goal)
  'q.hero.simpler': 'Who is in your story? Tell me their name.',
  'q.setting.simpler': 'Where does it happen?',
  'q.goal.simpler': 'What do they want?',

  // Rhyme step
  'rhyme.stepTitle': 'Should your story rhyme?',
  'rhyme.yes': 'Yes, make it rhyme',
  'rhyme.no': 'No, regular story',

  // Errors
  'error.generic': 'Something went wrong. Please try again.',
} as const;

export type StringKey = keyof typeof en;
