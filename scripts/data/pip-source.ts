// Pip the Dragon Bakes a Loaf — 7 paragraphs lifted from the production
// story (id af135405-b8fd-4094-bcac-86f6ac7c2460). Used by the seed
// script as the English source that Claude translates to Swedish for the
// default Swedish story.

export const PIP_TITLE_EN = 'Pip the Dragon Bakes a Loaf';

export interface PipPara {
  text: string;
  image_prompt: string;
}

export const PIP_PARAGRAPHS_EN: PipPara[] = [
  {
    text: 'High up on a tall mountain, there was a cozy little bakery. It had warm yellow lights, a big stone oven, and the smell of fresh bread floating out the door. That is where Pip the friendly dragon liked to spend his days.',
    image_prompt: 'A small friendly dragon named Pip standing outside a cozy cartoon bakery on a snowy mountain, warm yellow lights glowing in the window, bright colors.',
  },
  {
    text: 'Pip wanted more than anything to bake the perfect loaf of bread. He had tried many times before, but something always went wrong. Once the bread was too flat, and once it was too lumpy.',
    image_prompt: 'Friendly cartoon dragon Pip inside a warm bakery kitchen, looking at a flat lumpy loaf of bread on a wooden table, scratching his head with a puzzled smile.',
  },
  {
    text: 'One morning, Pip mixed the flour and water and a pinch of salt very carefully. He kneaded the dough with his little claws, folding it over and over. He was so proud of how soft and round it looked.',
    image_prompt: 'Friendly cartoon dragon Pip wearing a small apron, kneading a round ball of dough on a flour dusted table inside the cozy mountain bakery, big happy smile.',
  },
  {
    text: 'Then came the tricky part, putting the bread in the oven. Pip used his own warm dragon breath to heat the stone oven just right. But he breathed a little too much and the top of the loaf turned very dark.',
    image_prompt: 'Friendly cartoon dragon Pip opening a big stone oven in the bakery, a slightly too dark loaf of bread on the rack, Pip looking surprised with a small puff of smoke from his nose.',
  },
  {
    text: 'Pip felt a little sad. He sat down on a flour sack and sighed. His friend Marta the mountain mouse came over and patted his tail. She said, every baker makes mistakes, that is how you learn.',
    image_prompt: 'Friendly cartoon dragon Pip sitting sadly on a flour sack in the bakery, a tiny smiling mouse patting his tail, warm cozy bakery background with shelves of bread.',
  },
  {
    text: 'Pip smiled and stood right back up. He mixed a brand new batch of dough and this time he breathed very gently into the oven, slow and steady and warm. He watched and waited and hummed a little song.',
    image_prompt: 'Friendly cartoon dragon Pip carefully blowing gentle warm breath into a glowing stone oven in the cozy bakery, eyes focused and calm, Marta the mouse watching nearby.',
  },
  {
    text: 'When the timer rang, Pip pulled out a loaf that was perfectly golden and round. The whole bakery smelled amazing. Pip and Marta shared a big warm slice together, and Pip giggled with joy.',
    image_prompt: 'Friendly cartoon dragon Pip and a tiny mouse sitting at a small table in the cozy mountain bakery, sharing a golden loaf of bread, both smiling with crumbs on their chins.',
  },
];
