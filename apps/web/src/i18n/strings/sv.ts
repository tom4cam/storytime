import type { StringKey } from './en';

export const sv: Record<StringKey, string> = {
  // Brand and dedication
  'brand.name': 'storytime',
  'brand.tagline': 'Berätta en saga. Hör den. Se den.',
  'dedication.line': 'Gjord med kärlek av farbror Tom till Brennans och Linnéas födelsedagar.',

  // Home page
  'home.heroTitle': 'Skapa en saga. Vad du vill.',
  'home.heroBody': 'Välj en hjälte, välj en plats, välj ett problem. Sagomakaren skriver den, ritar den och läser den högt bara för dig.',
  'home.heroCta': 'Börja en ny saga',
  'home.recentHeading': 'Senaste sagorna',
  'home.recentLoading': 'Laddar senaste sagorna...',
  'home.recentEmpty': 'Inga sagor än. Tryck på den stora gula knappen för att skapa den första.',

  // Create page chrome
  'create.langStepTitle': 'Välj ett språk för din saga.',
  'create.langStepEn': 'English',
  'create.langStepSv': 'Svenska',
  'create.hearAgain': 'Hör frågan igen',
  'create.skipThis': 'Hoppa över',
  'create.next': 'Nästa',
  'create.saveAnswer': 'Spara svar',
  'create.makeStory': 'Skapa min saga',
  'create.required': 'Du behöver svara på den här.',
  'create.optional': 'Den här är frivillig. Skriv mer om du vill, eller hoppa över.',
  'create.soFar': 'Hittills:',
  'create.allSet': 'Klart.',
  'create.allSetHint': 'Tryck på "Skapa min saga" för att sätta ihop allt.',
  'create.sending': 'Skickar iväg till sagoberättarna...',
  'create.typeOrSpeak': 'Skriv eller säg ett svar först.',

  // Question prompts
  'q.hero.prompt': 'Vem är hjälten i din saga?',
  'q.hero.spoken': 'Vem är hjälten i din saga? Säg ett namn och hur de är.',
  'q.hero.placeholder': 'Exempel: en modig kanin som heter Pip och älskar kakor',
  'q.setting.prompt': 'Var händer sagan?',
  'q.setting.spoken': 'Var händer sagan?',
  'q.setting.placeholder': 'Exempel: i en magisk skog, eller på ett piratskepp',
  'q.goal.prompt': 'Vad vill eller behöver hjälten?',
  'q.goal.spoken': 'Vad vill eller behöver hjälten?',
  'q.goal.placeholder': 'Exempel: hitta världens största pannkaka',
  'q.friend.prompt': 'Finns det en vän eller hjälpare? Vem är det?',
  'q.friend.spoken': 'Finns det en vän eller hjälpare? Vem är det?',
  'q.friend.placeholder': 'Exempel: en klok gammal sköldpadda som heter Sage',
  'q.problem.prompt': 'Vilket problem ska de lösa?',
  'q.problem.spoken': 'Vilket problem ska de lösa?',
  'q.problem.placeholder': 'Exempel: bron till pannkaksberget är trasig',
  'q.ending.prompt': 'Hur ska sagan sluta?',
  'q.ending.spoken': 'Hur ska sagan sluta? Glatt, fånigt eller överraskande?',
  'q.ending.placeholder': 'Exempel: glatt och fånigt, med en stor pannkaksfest',

  // Story page
  'story.opening': 'Öppnar sagan...',
  'story.notFound': 'Sagan hittades inte.',
  'story.backHome': 'Tillbaka till start',
  'story.makingTitle': 'Skapar din saga...',
  'story.makingHint': 'Skriver orden, ritar bilderna och spelar in rösten. Det tar ungefär en minut. Sidan uppdateras av sig själv.',
  'story.failedTitle': 'Något gick fel.',
  'story.failedDefault': 'Sagan kunde inte skapas den här gången.',
  'story.tryNew': 'Pröva en ny',
  'story.versionPrefix': 'Version',
  'story.savedPrefix': 'sparad',
  'story.editLink': 'Redigera den här sagan',
  'story.makeAnother': 'Skapa en ny',
  'story.download': 'Ladda ner som PDF',
  'story.delete': 'Ta bort sagan',
  'story.deleteConfirmTitle': 'Ta bort den här sagan?',
  'story.deleteConfirmBody': 'Det går inte att ångra. Sagan, alla versioner, bilder och ljud tas bort.',
  'story.deleteYes': 'Ja, ta bort',
  'story.deleteNo': 'Behåll den',
  'story.deleteFailed': 'Det gick inte att ta bort sagan. Försök igen.',

  // Edit page
  'edit.loading': 'Laddar sagan...',
  'edit.notFound': 'Sagan hittades inte.',
  'edit.sending': 'Skickar ändringarna...',
  'edit.heading': 'Redigera saga',
  'edit.versionNote': 'När du sparar skapas version {next}.',
  'edit.titleLabel': 'Titel',
  'edit.summaryLabel': 'Sammanfattning av sagan och karaktärerna',
  'edit.summaryHint': 'Frivilligt. Använd det här för att hålla karaktärernas utseende konsekvent. Det du skriver läggs till varje ombritad bild som sammanhang, så beskriv hårfärg, ålder, kläder och annat viktigt. Exempel: "Bob är en man med kort blont hår och kort blont skägg, klädd i kockförkläde. Brennan är en 10-årig blond pojke."',
  'edit.summaryPlaceholder': 'Beskriv huvudkaraktärernas utseende och sagans känsla...',
  'edit.paragraphLabel': 'Stycke {n}',
  'edit.regenerateImage': 'Rita om bilden när jag sparar',
  'edit.cancel': 'Avbryt',
  'edit.save': 'Spara som ny version',

  // Not found page
  'notFound.title': 'Den sidan tappade bort sig i skogen.',
  'notFound.body': 'Vi går tillbaka och väljer en annan stig.',

  // Mic / speech
  'mic.start': 'Säg ditt svar',
  'mic.stop': 'Sluta spela in',
  'mic.unavailable': 'Röstinmatning fungerar inte i den här webbläsaren. Du kan fortfarande skriva svaret. (Chrome och Edge fungerar bäst för röst.)',
  'mic.notHeard': 'Förlåt, jag hörde inte. Försök igen.',

  // Navigation
  'nav.back': 'Tillbaka',

  // Audio player
  'audio.play': 'Spela',
  'audio.pause': 'Pausa',
  'audio.replay': 'Spela igen',

  // Settings cog
  'settings.title': 'Inställningar',
  'settings.language': 'Språk',
  'settings.languageEn': 'English',
  'settings.languageSv': 'Svenska',
  'settings.slow': 'Talhastighet',
  'settings.slowOn': 'Långsam',
  'settings.slowOff': 'Normal',
  'settings.close': 'Stäng',

  // Story-type opener
  'opener.title': 'Vilken sorts saga vill du ha?',
  'opener.spoken': 'Vilken sorts saga vill du ha?',
  'opener.chip.adventure': 'Äventyr',
  'opener.chip.silly': 'Tokigt',
  'opener.chip.animals': 'Djurvänner',
  'opener.chip.bedtime': 'Lugn godnattsaga',
  'opener.chip.magic': 'Magi',
  'opener.chip.mystery': 'Mysterium',
  'opener.chip.surprise': 'Överraska mig',
  'opener.placeholder': 'Eller berätta din egen idé',

  // Moderation redirect
  'mod.redirectTitle': 'Vi väljer något annat.',
  'mod.redirectBody': 'Hur är det med någon av dessa?',

  // Voice picker
  'voice.stepTitle': 'Välj en röst som läser din saga.',
  'voice.playSample': 'Spela exempel',
  'voice.next': 'Använd den här rösten',

  // Helpers (per-question)
  'help.simpler': 'Säg det enklare',
  'help.original': 'Säg det vanligt',
  'help.yesno': 'Hjälp mig svara',
  'help.yes': 'Ja',
  'help.no': 'Nej',
  'help.cancel': 'Glöm det',

  // Per-question simpler variants (hero/setting/goal)
  'q.hero.simpler': 'Vem är med i din saga? Säg vad de heter.',
  'q.setting.simpler': 'Var händer det?',
  'q.goal.simpler': 'Vad vill de?',

  // Errors
  'error.generic': 'Något gick fel. Försök igen.',
};
