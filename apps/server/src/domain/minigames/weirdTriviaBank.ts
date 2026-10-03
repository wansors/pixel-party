import type { QuizEntry, QuizEntryText } from './quizCore'

// Weird Trivia question bank: strange but TRUE facts (every right answer is real and verifiable; the
// decoys are absurd-but-plausible and false). Each language is written natively — its own phrasing and
// its own jokes, not a literal translation. A wordplay question may even ask a different thing per
// language (`tittle`), as long as both are true and equally hard. Budgets (checked by the tests): a
// question fits the board, a choice fits a tile (≤ 24 chars), a fact fits the reveal (≤ 120 chars).

export interface WeirdFactText extends QuizEntryText {
  fact: string
}

export type WeirdFact = QuizEntry<WeirdFactText>

export const WEIRD_TRIVIA_BANK: readonly WeirdFact[] = [
  // --- Animals -------------------------------------------------------------------------------------
  {
    id: 'wombat-cubes',
    text: {
      en: {
        q: 'What shape is wombat poop?',
        right: 'Cubes',
        wrong: ['Spirals', 'Stars', 'Tiny hearts'],
        fact: 'Wombats leave their cube-shaped droppings on rocks and logs to mark territory. Cubes don’t roll away.',
      },
      es: {
        q: '¿Qué forma tiene la caca de wombat?',
        right: 'Cubos',
        wrong: ['Espirales', 'Estrellas', 'Corazoncitos'],
        fact: 'Los wombats dejan sus cagarrutas cúbicas sobre piedras y troncos para marcar territorio. Los cubos no ruedan.',
      },
    },
  },
  {
    id: 'octopus-hearts',
    text: {
      en: {
        q: 'How many hearts does an octopus have?',
        right: 'Three',
        wrong: ['One', 'Two', 'Eight'],
        fact: 'Three hearts pumping blue, copper-based blood.',
      },
      es: {
        q: '¿Cuántos corazones tiene un pulpo?',
        right: 'Tres',
        wrong: ['Uno', 'Dos', 'Ocho'],
        fact: 'Tres corazones que bombean sangre azul, rica en cobre.',
      },
    },
  },
  {
    id: 'shrimp-heart',
    text: {
      en: {
        q: 'Where is a shrimp’s heart?',
        right: 'In its head',
        wrong: ['In its tail', 'In its legs', 'It has none'],
        fact: 'Heart, stomach and brain are all packed into the head — the part most people throw away.',
      },
      es: {
        q: '¿Dónde tiene el corazón una gamba?',
        right: 'En la cabeza',
        wrong: ['En la cola', 'En las patas', 'No tiene'],
        fact: 'Corazón, estómago y cerebro van todos en la cabeza. Por algo se chupan.',
      },
    },
  },
  {
    id: 'otters-hands',
    text: {
      en: {
        q: 'What do sea otters do so they don’t drift apart while sleeping?',
        right: 'Hold hands',
        wrong: ['Snore in sync', 'Bite each tail', 'Sleep in shifts'],
        fact: 'They also wrap themselves in kelp, like a seaweed seatbelt.',
      },
      es: {
        q: '¿Qué hacen las nutrias marinas para no separarse mientras duermen?',
        right: 'Darse la mano',
        wrong: ['Roncar a la vez', 'Morderse la cola', 'Dormir por turnos'],
        fact: 'También se enrollan en algas, como un cinturón de seguridad marino.',
      },
    },
  },
  {
    id: 'turtle-butt',
    text: {
      en: {
        q: 'How do some turtles breathe underwater?',
        right: 'Through their butt',
        wrong: ['Through their ears', 'With shell gills', 'Holding a bubble'],
        fact: 'Australia’s Fitzroy River turtle absorbs oxygen through its cloaca. Yes, that end.',
      },
      es: {
        q: '¿Cómo respiran bajo el agua algunas tortugas?',
        right: 'Por el culo',
        wrong: ['Por las orejas', 'Con branquias', 'Con una burbuja'],
        fact: 'La tortuga del río Fitzroy (Australia) absorbe oxígeno por la cloaca. Sí, por ahí.',
      },
    },
  },
  {
    id: 'koala-prints',
    text: {
      en: {
        q: 'Whose fingerprints are almost identical to ours?',
        right: 'Koalas',
        wrong: ['Pandas', 'Raccoons', 'Sloths'],
        fact: 'Even under a microscope they’re hard to tell apart. The perfect alibi for a koala.',
      },
      es: {
        q: '¿Qué animal tiene huellas dactilares casi idénticas a las nuestras?',
        right: 'El koala',
        wrong: ['El panda', 'El mapache', 'El perezoso'],
        fact: 'Ni al microscopio es fácil distinguirlas. La coartada perfecta para un koala.',
      },
    },
  },
  {
    id: 'butterfly-feet',
    text: {
      en: {
        q: 'What do butterflies taste with?',
        right: 'Their feet',
        wrong: ['Their wings', 'Their eyes', 'Their tail'],
        fact: 'They stand on a leaf to “taste” it before laying their eggs on it.',
      },
      es: {
        q: '¿Con qué saborean las mariposas?',
        right: 'Con las patas',
        wrong: ['Con las alas', 'Con los ojos', 'Con la cola'],
        fact: 'Se posan en una hoja para “probarla” antes de poner sus huevos en ella.',
      },
    },
  },
  {
    id: 'snail-teeth',
    text: {
      en: {
        q: 'How many teeth can a garden snail have?',
        right: 'Thousands',
        wrong: ['None', 'Two', 'Exactly 32'],
        fact: 'Rows of tiny teeth line its radula, a tongue that works like a file.',
      },
      es: {
        q: '¿Cuántos dientes puede tener un caracol de jardín?',
        right: 'Miles',
        wrong: ['Ninguno', 'Dos', 'Exactamente 32'],
        fact: 'Hileras de dientecillos cubren su rádula, una lengua que funciona como una lima.',
      },
    },
  },
  {
    id: 'rats-laugh',
    text: {
      en: {
        q: 'What do rats do when you tickle them?',
        right: 'Laugh',
        wrong: ['Sneeze', 'Turn pink', 'Purr'],
        fact: 'Ultrasonic giggles, too high for us to hear. Then they chase the hand for more.',
      },
      es: {
        q: '¿Qué hacen las ratas cuando les haces cosquillas?',
        right: 'Reírse',
        wrong: ['Estornudar', 'Ponerse rosas', 'Ronronear'],
        fact: 'Risitas ultrasónicas que no oímos. Y luego persiguen la mano para que sigas.',
      },
    },
  },
  {
    id: 'goat-pupils',
    text: {
      en: {
        q: 'What shape are a goat’s pupils?',
        right: 'Rectangles',
        wrong: ['Stars', 'Hearts', 'Triangles'],
        fact: 'Wide horizontal slits give goats a panoramic view to spot predators coming.',
      },
      es: {
        q: '¿Qué forma tienen las pupilas de una cabra?',
        right: 'Rectangular',
        wrong: ['De estrella', 'De corazón', 'Triangular'],
        fact: 'Sus rendijas horizontales les dan una visión panorámica para ver venir a los depredadores.',
      },
    },
  },
  {
    id: 'seahorse-dads',
    text: {
      en: {
        q: 'In seahorses, who gets pregnant?',
        right: 'The male',
        wrong: ['The female', 'They take turns', 'The grandmother'],
        fact: 'The female puts her eggs in the male’s pouch, and he gives birth to the babies.',
      },
      es: {
        q: 'En los caballitos de mar, ¿quién se queda embarazado?',
        right: 'El macho',
        wrong: ['La hembra', 'Se turnan', 'La abuela'],
        fact: 'La hembra deja los huevos en la bolsa del macho, y es él quien da a luz.',
      },
    },
  },
  {
    id: 'roach-headless',
    text: {
      en: {
        q: 'How long can a cockroach live without its head?',
        right: 'About a week',
        wrong: ['5 seconds', '1 hour', 'Forever'],
        fact: 'It breathes through holes in its body. In the end it dies of thirst.',
      },
      es: {
        q: '¿Cuánto puede vivir una cucaracha sin cabeza?',
        right: 'Una semana',
        wrong: ['5 segundos', '1 hora', 'Para siempre'],
        fact: 'Respira por agujeros del cuerpo. Al final se muere de sed.',
      },
    },
  },
  {
    id: 'ostrich-eye',
    text: {
      en: {
        q: 'An ostrich’s eye is bigger than its…',
        right: 'Brain',
        wrong: ['Heart', 'Foot', 'Egg'],
        fact: 'Each eye is about 5 cm across, the biggest of any land animal.',
      },
      es: {
        q: 'El ojo de un avestruz es más grande que su…',
        right: 'Cerebro',
        wrong: ['Corazón', 'Pata', 'Huevo'],
        fact: 'Cada ojo mide unos 5 cm, el más grande de cualquier animal terrestre.',
      },
    },
  },
  {
    id: 'platypus-stomach',
    text: {
      en: {
        q: 'Which organ does a platypus NOT have?',
        right: 'A stomach',
        wrong: ['A heart', 'Lungs', 'A brain'],
        fact: 'Food goes straight from its gullet to its gut. The males are venomous, too.',
      },
      es: {
        q: '¿Qué órgano NO tiene el ornitorrinco?',
        right: 'Estómago',
        wrong: ['Corazón', 'Pulmones', 'Cerebro'],
        fact: 'La comida pasa directa del esófago al intestino. Y los machos son venenosos.',
      },
    },
  },
  {
    id: 'immortal-jelly',
    text: {
      en: {
        q: 'Which animal can turn back its own aging?',
        right: 'A jellyfish',
        wrong: ['A tortoise', 'A lobster', 'A parrot'],
        fact: 'Turritopsis dohrnii can turn back into a polyp and start its life over.',
      },
      es: {
        q: '¿Qué animal puede revertir su propio envejecimiento?',
        right: 'Una medusa',
        wrong: ['Una tortuga', 'Una langosta', 'Un loro'],
        fact: 'La Turritopsis dohrnii puede volver a ser pólipo y empezar su vida de cero.',
      },
    },
  },
  {
    id: 'penguin-pebble',
    text: {
      en: {
        q: 'How does a male gentoo penguin court a female?',
        right: 'Gives her a pebble',
        wrong: ['Builds an igloo', 'Wears a feather crown', 'Writes in the snow'],
        fact: 'The best pebbles become the nest. Some are stolen from the neighbours.',
      },
      es: {
        q: '¿Cómo corteja un pingüino papúa macho a una hembra?',
        right: 'Le regala una piedra',
        wrong: ['Le hace un iglú', 'Se pone una corona', 'Escribe en la nieve'],
        fact: 'Las mejores piedras acaban en el nido. Algunas, robadas a los vecinos.',
      },
    },
  },
  {
    id: 'cats-sweet',
    text: {
      en: {
        q: 'Which flavour can’t cats taste?',
        right: 'Sweet',
        wrong: ['Salty', 'Bitter', 'Sour'],
        fact: 'A broken gene: cats have no working sweet receptor. Cake is wasted on them.',
      },
      es: {
        q: '¿Qué sabor no pueden notar los gatos?',
        right: 'El dulce',
        wrong: ['El salado', 'El amargo', 'El ácido'],
        fact: 'Un gen roto: los gatos no tienen un receptor del dulce que funcione. La tarta, para ti.',
      },
    },
  },
  {
    id: 'zombie-ants',
    text: {
      en: {
        q: 'A tropical fungus can turn ants into…',
        right: 'Zombies',
        wrong: ['Glow sticks', 'Queens', 'Vegetarians'],
        fact: 'It steers them up a plant, kills them, then sprouts from their head to rain spores.',
      },
      es: {
        q: 'Un hongo tropical puede convertir a las hormigas en…',
        right: 'Zombis',
        wrong: ['Linternas', 'Reinas', 'Vegetarianas'],
        fact: 'Las hace subir a una planta, las mata y les brota de la cabeza para llover esporas.',
      },
    },
  },
  {
    id: 'hippo-sweat',
    text: {
      en: {
        q: 'What colour is hippo sweat?',
        right: 'Red',
        wrong: ['Blue', 'Green', 'Glitter'],
        fact: 'It isn’t blood: the red goo works as sunscreen and antiseptic.',
      },
      es: {
        q: '¿De qué color es el sudor del hipopótamo?',
        right: 'Rojo',
        wrong: ['Azul', 'Verde', 'Purpurina'],
        fact: 'No es sangre: esa sustancia roja hace de protector solar y de antiséptico.',
      },
    },
  },
  {
    id: 'cheetah-roar',
    text: {
      en: {
        q: 'What can’t cheetahs do that lions can?',
        right: 'Roar',
        wrong: ['Purr', 'Run', 'Climb trees'],
        fact: 'Instead they chirp like birds — and purr like house cats.',
      },
      es: {
        q: '¿Qué no pueden hacer los guepardos que los leones sí?',
        right: 'Rugir',
        wrong: ['Ronronear', 'Correr', 'Trepar'],
        fact: 'En su lugar pían como pájaros y ronronean como un gato de sofá.',
      },
    },
  },
  {
    id: 'giraffe-neck',
    text: {
      en: {
        q: 'How many neck bones does a giraffe have?',
        right: 'Seven, like you',
        wrong: ['25', '60', 'Just one'],
        fact: 'Same count as humans, but each one can be over 25 cm long.',
      },
      es: {
        q: '¿Cuántas vértebras tiene el cuello de una jirafa?',
        right: 'Siete, como tú',
        wrong: ['25', '60', 'Solo una'],
        fact: 'Las mismas que tú, pero cada una puede medir más de 25 cm.',
      },
    },
  },
  {
    id: 'shrek-sheep',
    text: {
      en: {
        q: 'How did Shrek, a New Zealand sheep, become famous?',
        right: 'Hid from shearers',
        wrong: ['Learned to bark', 'Ran for mayor', 'Ate a phone'],
        fact: 'He dodged shearing for six years in a cave. His fleece weighed 27 kg — enough for 20 suits.',
      },
      es: {
        q: '¿Por qué se hizo famoso Shrek, un carnero de Nueva Zelanda?',
        right: 'Se escondió 6 años',
        wrong: ['Aprendió a ladrar', 'Se presentó a alcalde', 'Se comió un móvil'],
        fact: 'Esquivó el esquileo seis años en una cueva. Su lana pesaba 27 kg: para unos 20 trajes.',
      },
    },
  },
  {
    id: 'headless-mike',
    text: {
      en: {
        q: 'How long did Mike the chicken live after losing his head?',
        right: '18 months',
        wrong: ['3 minutes', '2 days', '1 week'],
        fact: 'His owner fed him with an eyedropper, and Mike toured the US as a sideshow star.',
      },
      es: {
        q: '¿Cuánto vivió Mike, un pollo, después de perder la cabeza?',
        right: '18 meses',
        wrong: ['3 minutos', '2 días', '1 semana'],
        fact: 'Su dueño lo alimentaba con un cuentagotas y Mike se fue de gira por EE. UU. como atracción.',
      },
    },
  },
  // --- History ---------------------------------------------------------------------------------------
  {
    id: 'shortest-war',
    text: {
      en: {
        q: 'How long did the shortest war in history last?',
        right: 'About 40 minutes',
        wrong: ['3 days', '6 hours', '2 weeks'],
        fact: 'Britain vs. Zanzibar, 27 August 1896. Zanzibar surrendered in under 45 minutes.',
      },
      es: {
        q: '¿Cuánto duró la guerra más corta de la historia?',
        right: 'Unos 40 minutos',
        wrong: ['3 días', '6 horas', '2 semanas'],
        fact: 'Reino Unido contra Zanzíbar, 27 de agosto de 1896. Zanzíbar se rindió en menos de 45 minutos.',
      },
    },
  },
  {
    id: 'cleopatra-moon',
    text: {
      en: {
        q: 'Cleopatra lived closer in time to…',
        right: 'The Moon landing',
        wrong: ['The Great Pyramid', 'The first pharaoh', 'Early Stonehenge'],
        fact: 'About 2,500 years separate her from the Great Pyramid, and about 2,000 from Apollo 11.',
      },
      es: {
        q: 'Cleopatra vivió más cerca en el tiempo de…',
        right: 'La llegada a la Luna',
        wrong: ['La Gran Pirámide', 'El primer faraón', 'El primer Stonehenge'],
        fact: 'Unos 2.500 años la separan de la Gran Pirámide y unos 2.000 del Apolo 11.',
      },
    },
  },
  {
    id: 'oxford-aztecs',
    text: {
      en: {
        q: 'Oxford University is older than…',
        right: 'The Aztec Empire',
        wrong: ['The Vikings', 'Chess', 'Paper money'],
        fact: 'Teaching in Oxford began by 1096. The Aztec capital, Tenochtitlan, was founded in 1325.',
      },
      es: {
        q: 'La Universidad de Oxford es más antigua que…',
        right: 'El Imperio azteca',
        wrong: ['Los vikingos', 'El ajedrez', 'El papel moneda'],
        fact: 'En Oxford ya se enseñaba en 1096. Tenochtitlan, la capital azteca, se fundó en 1325.',
      },
    },
  },
  {
    id: 'marathon-1904',
    text: {
      en: {
        q: 'What did the 1904 Olympic marathon winner drink mid-race?',
        right: 'Brandy and rat poison',
        wrong: ['Pickle juice', 'Hot chocolate', 'Seawater'],
        fact: 'Strychnine was used as a “stimulant”. Another runner did part of the course by car.',
      },
      es: {
        q: '¿Qué bebió en plena carrera el ganador del maratón olímpico de 1904?',
        right: 'Coñac y matarratas',
        wrong: ['Zumo de pepinillo', 'Chocolate caliente', 'Agua de mar'],
        fact: 'La estricnina se usaba como “estimulante”. Otro corredor hizo parte del recorrido en coche.',
      },
    },
  },
  {
    id: 'dancing-plague',
    text: {
      en: {
        q: 'In 1518, hundreds of people in Strasbourg couldn’t stop…',
        right: 'Dancing',
        wrong: ['Sneezing', 'Talking backwards', 'Barking'],
        fact: 'The “dancing plague” lasted weeks. The city hired musicians, hoping it would help.',
      },
      es: {
        q: 'En 1518, cientos de personas en Estrasburgo no podían parar de…',
        right: 'Bailar',
        wrong: ['Estornudar', 'Hablar al revés', 'Ladrar'],
        fact: 'La “epidemia de baile” duró semanas. La ciudad contrató músicos, a ver si así se curaban.',
      },
    },
  },
  {
    id: 'napoleon-rabbits',
    text: {
      en: {
        q: 'Napoleon was once attacked by a horde of…',
        right: 'Rabbits',
        wrong: ['Geese', 'Squirrels', 'Ducks'],
        fact: 'A hunt was set up with hundreds of tame rabbits. They charged at him instead of fleeing.',
      },
      es: {
        q: 'Napoleón fue atacado una vez por una horda de…',
        right: 'Conejos',
        wrong: ['Gansos', 'Ardillas', 'Patos'],
        fact: 'Le montaron una cacería con cientos de conejos domésticos, que cargaron contra él en vez de huir.',
      },
    },
  },
  {
    id: 'emu-war',
    text: {
      en: {
        q: 'In 1932, the Australian army went to war against…',
        right: 'Emus',
        wrong: ['Kangaroos', 'Koalas', 'Crocodiles'],
        fact: 'Soldiers with machine guns vs. some 20,000 emus. The emus won.',
      },
      es: {
        q: 'En 1932, el ejército australiano le declaró la guerra a…',
        right: 'Los emús',
        wrong: ['Los canguros', 'Los koalas', 'Los cocodrilos'],
        fact: 'Soldados con ametralladoras contra unos 20.000 emús. Ganaron los emús.',
      },
    },
  },
  {
    id: 'pig-trial',
    text: {
      en: {
        q: 'In 1386, in Falaise (France), a pig was…',
        right: 'Tried and hanged',
        wrong: ['Crowned king', 'Made a bishop', 'Elected mayor'],
        fact: 'Medieval animal trials were real. This pig was even dressed in clothes for its execution.',
      },
      es: {
        q: 'En 1386, en Falaise (Francia), un cerdo fue…',
        right: 'Juzgado y ahorcado',
        wrong: ['Coronado rey', 'Nombrado obispo', 'Elegido alcalde'],
        fact: 'Los juicios a animales existieron. A este cerdo hasta lo vistieron para la ejecución.',
      },
    },
  },
  {
    id: 'byron-bear',
    text: {
      en: {
        q: 'Cambridge banned dogs, so the poet Lord Byron kept a…',
        right: 'Bear',
        wrong: ['Crocodile', 'Pig', 'Goose'],
        fact: 'The rules said nothing about bears, so the college couldn’t stop him.',
      },
      es: {
        q: 'Cambridge prohibía los perros, así que el poeta Lord Byron tenía un…',
        right: 'Oso',
        wrong: ['Cocodrilo', 'Cerdo', 'Ganso'],
        fact: 'Las normas no decían nada de osos, así que la universidad no pudo impedirlo.',
      },
    },
  },
  {
    id: 'beard-tax',
    text: {
      en: {
        q: 'Peter the Great of Russia put a tax on…',
        right: 'Beards',
        wrong: ['Yawning', 'Sneezing', 'Snowmen'],
        fact: 'Bearded men paid up and carried a token as proof. Shaving was cheaper.',
      },
      es: {
        q: 'Pedro el Grande de Rusia puso un impuesto a…',
        right: 'Las barbas',
        wrong: ['Los bostezos', 'Los estornudos', 'Los muñecos de nieve'],
        fact: 'Los barbudos pagaban y llevaban una ficha como prueba. Afeitarse salía más barato.',
      },
    },
  },
  {
    id: 'emperor-norton',
    text: {
      en: {
        q: 'In 1859, a San Francisco man declared himself…',
        right: 'Emperor of the USA',
        wrong: ['King of the Moon', 'Pope of Mexico', 'Mayor of Mars'],
        fact: 'Emperor Norton I printed his own money, and some local shops actually accepted it.',
      },
      es: {
        q: 'En 1859, un vecino de San Francisco se proclamó…',
        right: 'Emperador de EE. UU.',
        wrong: ['Rey de la Luna', 'Papa de México', 'Alcalde de Marte'],
        fact: 'Norton I imprimía su propio dinero, y algunas tiendas de la ciudad lo aceptaban.',
      },
    },
  },
  {
    id: 'knocker-upper',
    text: {
      en: {
        q: 'Before alarm clocks, some British workers paid someone to…',
        right: 'Shoot peas at windows',
        wrong: ['Sing under balconies', 'Play the bagpipes', 'Release a rooster'],
        fact: '“Knocker-uppers” tapped on windows with long poles or pea shooters to wake them.',
      },
      es: {
        q: 'Antes de los despertadores, algunos obreros británicos pagaban a alguien para…',
        right: 'Tirarles guisantes',
        wrong: ['Darles serenata', 'Tocar la gaita', 'Soltarles un gallo'],
        fact: 'Los “knocker-uppers” golpeaban las ventanas con pértigas o cerbatanas de guisantes.',
      },
    },
  },
  {
    id: 'celtiberian-teeth',
    text: {
      en: {
        q: 'What did the ancient Celtiberians clean their teeth with?',
        right: 'Urine',
        wrong: ['Melted cheese', 'Squid ink', 'Rust'],
        fact: 'So wrote Diodorus and Catullus. Catullus even mocked one for his urine-white grin.',
      },
      es: {
        q: '¿Con qué se limpiaban los dientes los antiguos celtíberos?',
        right: 'Con orina',
        wrong: ['Con queso fundido', 'Con tinta de calamar', 'Con óxido'],
        fact: 'Lo cuentan Diodoro y Catulo, que se burló de un celtíbero por su sonrisa blanqueada con pis.',
      },
    },
  },
  {
    id: 'ketchup-medicine',
    text: {
      en: {
        q: 'In the 1830s, ketchup was sold in the US as…',
        right: 'Medicine',
        wrong: ['Hair dye', 'Paint', 'Perfume'],
        fact: 'Tomato pills promised to cure indigestion. They didn’t.',
      },
      es: {
        q: 'En la década de 1830, en EE. UU. se vendía el kétchup como…',
        right: 'Medicina',
        wrong: ['Tinte de pelo', 'Pintura', 'Perfume'],
        fact: 'Unas píldoras de tomate prometían curar la indigestión. No la curaban.',
      },
    },
  },
  {
    id: 'lobster-prison',
    text: {
      en: {
        q: 'In colonial America, lobster was considered…',
        right: 'Food for prisoners',
        wrong: ['A royal luxury', 'Bad luck', 'A pet'],
        fact: 'It was so plentiful it was fed to prisoners and used as fertiliser.',
      },
      es: {
        q: 'En la América colonial, la langosta se consideraba…',
        right: 'Comida de presos',
        wrong: ['Un lujo real', 'Mala suerte', 'Una mascota'],
        fact: 'Había tanta que se la daban a los presos y se usaba como abono.',
      },
    },
  },
  // --- Inventions and oddities -------------------------------------------------------------------------
  {
    id: 'nintendo-cards',
    text: {
      en: {
        q: 'What did Nintendo sell when it was founded in 1889?',
        right: 'Playing cards',
        wrong: ['Rice cookers', 'Umbrellas', 'Toy trains'],
        fact: 'Hanafuda cards. Before video games it also tried taxis and instant rice.',
      },
      es: {
        q: '¿Qué vendía Nintendo cuando se fundó en 1889?',
        right: 'Naipes',
        wrong: ['Arroceras', 'Paraguas', 'Trenes de juguete'],
        fact: 'Cartas hanafuda. Antes de los videojuegos también probó con taxis y arroz instantáneo.',
      },
    },
  },
  {
    id: 'pringles-urn',
    text: {
      en: {
        q: 'The inventor of the Pringles can was buried in…',
        right: 'A Pringles can',
        wrong: ['A giant crisp', 'A salt shaker', 'A lunchbox'],
        fact: 'In 2008 Fredric Baur’s family buried part of his ashes in one. Original flavour.',
      },
      es: {
        q: 'El inventor del tubo de Pringles fue enterrado en…',
        right: 'Un tubo de Pringles',
        wrong: ['Una patata gigante', 'Un salero', 'Una fiambrera'],
        fact: 'En 2008 su familia enterró parte de sus cenizas en uno. Sabor original, por supuesto.',
      },
    },
  },
  {
    id: 'chainsaw-birth',
    text: {
      en: {
        q: 'The chainsaw was first invented to help with…',
        right: 'Childbirth',
        wrong: ['Ice sculpture', 'Slicing bread', 'Shearing sheep'],
        fact: '18th-century Scottish doctors used a hand-cranked one to cut bone in difficult births.',
      },
      es: {
        q: 'La motosierra se inventó para ayudar en…',
        right: 'Los partos',
        wrong: ['Tallar hielo', 'Cortar pan', 'Esquilar ovejas'],
        fact: 'Médicos escoceses del siglo XVIII usaban una de manivela para cortar hueso en partos difíciles.',
      },
    },
  },
  {
    id: 'bubble-wrap',
    text: {
      en: {
        q: 'Bubble wrap was first invented as…',
        right: 'Wallpaper',
        wrong: ['Shoe insoles', 'Swimming caps', 'Pillow stuffing'],
        fact: 'As textured wallpaper it flopped in 1957. Wrapping IBM computers worked much better.',
      },
      es: {
        q: 'El plástico de burbujas se inventó primero como…',
        right: 'Papel pintado',
        wrong: ['Plantillas', 'Gorros de piscina', 'Relleno de cojín'],
        fact: 'Como papel pintado fracasó en 1957. Envolviendo ordenadores de IBM, triunfó.',
      },
    },
  },
  {
    id: 'play-doh',
    text: {
      en: {
        q: 'Play-Doh was originally sold as…',
        right: 'Wallpaper cleaner',
        wrong: ['Bread dough', 'Chewing gum', 'Denture glue'],
        fact: 'When coal fires faded, so did sooty wallpaper. So it became a toy.',
      },
      es: {
        q: 'La plastilina Play-Doh se vendía en su origen como…',
        right: 'Limpiador de paredes',
        wrong: ['Masa de pan', 'Chicle', 'Pegamento dental'],
        fact: 'Al desaparecer las estufas de carbón, ya no había hollín en el papel pintado. Así que pasó a ser un juguete.',
      },
    },
  },
  {
    id: 'potato-head',
    text: {
      en: {
        q: 'What was the first toy ever advertised on TV?',
        right: 'Mr. Potato Head',
        wrong: ['The yo-yo', 'Barbie', 'The Slinky'],
        fact: '1952. The first sets only had the face parts: you brought a real potato.',
      },
      es: {
        q: '¿Cuál fue el primer juguete anunciado en televisión?',
        right: 'Mr. Potato',
        wrong: ['El yoyó', 'Barbie', 'El Slinky'],
        fact: '1952. Al principio solo venían las piezas de la cara: la patata la ponías tú.',
      },
    },
  },
  {
    id: 'coffee-webcam',
    text: {
      en: {
        q: 'What did the world’s first webcam watch?',
        right: 'A coffee pot',
        wrong: ['A fish tank', 'A parking spot', 'A cat'],
        fact: 'Cambridge, 1991: researchers wanted to know if the pot was empty before getting up.',
      },
      es: {
        q: '¿Qué vigilaba la primera webcam del mundo?',
        right: 'Una cafetera',
        wrong: ['Una pecera', 'Una plaza de parking', 'Un gato'],
        fact: 'Cambridge, 1991: unos investigadores querían saber si quedaba café antes de levantarse.',
      },
    },
  },
  {
    id: 'ebay-laser',
    text: {
      en: {
        q: 'What was the first item ever sold on eBay?',
        right: 'A broken laser pointer',
        wrong: ['A used toothbrush', 'A Pez dispenser', 'A haunted doll'],
        fact: 'It sold for $14.83. The buyer collected broken laser pointers.',
      },
      es: {
        q: '¿Qué fue lo primero que se vendió en eBay?',
        right: 'Un puntero láser roto',
        wrong: ['Un cepillo usado', 'Un dispensador Pez', 'Una muñeca maldita'],
        fact: 'Se vendió por 14,83 $. El comprador coleccionaba punteros láser rotos.',
      },
    },
  },
  {
    id: 'hawaiian-pizza',
    text: {
      en: {
        q: 'Where was Hawaiian pizza invented?',
        right: 'Canada',
        wrong: ['Hawaii', 'Italy', 'Japan'],
        fact: 'Greek-born Sam Panopoulos added pineapple in Ontario in 1962. Italy is still upset.',
      },
      es: {
        q: '¿Dónde se inventó la pizza hawaiana?',
        right: 'En Canadá',
        wrong: ['En Hawái', 'En Italia', 'En Japón'],
        fact: 'Sam Panopoulos, nacido en Grecia, le puso piña en Ontario en 1962. Italia aún no lo ha perdonado.',
      },
    },
  },
  // --- Places, customs and records ---------------------------------------------------------------------
  {
    id: 'scotland-unicorn',
    text: {
      en: {
        q: 'What is Scotland’s national animal?',
        right: 'The unicorn',
        wrong: ['Nessie', 'The haggis', 'A kilted sheep'],
        fact: 'A unicorn has guarded Scotland’s royal coat of arms for centuries.',
      },
      es: {
        q: '¿Cuál es el animal nacional de Escocia?',
        right: 'El unicornio',
        wrong: ['Nessie', 'El haggis', 'Una oveja con falda'],
        fact: 'Un unicornio custodia el escudo real de Escocia desde hace siglos.',
      },
    },
  },
  {
    id: 'swiss-guinea',
    text: {
      en: {
        q: 'In Switzerland it’s illegal to own just one…',
        right: 'Guinea pig',
        wrong: ['Cuckoo clock', 'Snail', 'Cactus'],
        fact: 'Guinea pigs are social animals, so Swiss law says they need company.',
      },
      es: {
        q: 'En Suiza es ilegal tener un solo…',
        right: 'Conejillo de Indias',
        wrong: ['Reloj de cuco', 'Caracol', 'Cactus'],
        fact: 'Son animales sociales, y la ley suiza les exige compañía.',
      },
    },
  },
  {
    id: 'naki-sumo',
    text: {
      en: {
        q: 'At a Japanese festival, sumo wrestlers compete to…',
        right: 'Make babies cry',
        wrong: ['Eat 100 rice balls', 'Lift a cow', 'Sing lullabies'],
        fact: 'Naki Sumo: a good loud cry is believed to make the baby grow up healthy.',
      },
      es: {
        q: 'En un festival japonés, luchadores de sumo compiten por…',
        right: 'Hacer llorar a bebés',
        wrong: ['Comer más arroz', 'Levantar una vaca', 'Cantar nanas'],
        fact: 'Naki Sumo: se cree que un buen llanto hace que el bebé crezca sano.',
      },
    },
  },
  {
    id: 'el-colacho',
    text: {
      en: {
        q: 'At a Spanish village festival, a man dressed as the devil…',
        right: 'Jumps over babies',
        wrong: ['Steals the sheep', 'Rings every bell', 'Judges a paella'],
        fact: 'El Colacho, in Castrillo de Murcia (Burgos), since 1620. The babies lie on mattresses.',
      },
      es: {
        q: 'En las fiestas de un pueblo de Burgos, un hombre vestido de diablo…',
        right: 'Salta sobre bebés',
        wrong: ['Roba las ovejas', 'Toca las campanas', 'Juzga una paella'],
        fact: 'El Colacho, en Castrillo de Murcia, desde 1620. Los bebés esperan tumbados en colchones.',
      },
    },
  },
  {
    id: 'wife-carrying',
    text: {
      en: {
        q: 'The Wife Carrying World Championship winner gets…',
        right: 'Wife’s weight in beer',
        wrong: ['A reindeer', 'A free divorce', 'A golden sauna'],
        fact: 'Held in Sonkajärvi, Finland, since 1992. The one carried doesn’t have to be your wife.',
      },
      es: {
        q: 'El ganador del Mundial de Carga de Esposas se lleva…',
        right: 'Su peso en cerveza',
        wrong: ['Un reno', 'Un divorcio gratis', 'Una sauna de oro'],
        fact: 'Se celebra en Sonkajärvi (Finlandia) desde 1992. No hace falta que sea tu esposa.',
      },
    },
  },
  {
    id: 'broken-museum',
    text: {
      en: {
        q: 'What does a museum in Zagreb collect?',
        right: 'Breakup souvenirs',
        wrong: ['Lost socks', 'Bad smells', 'Fake moustaches'],
        fact: 'The Museum of Broken Relationships: objects donated from failed loves, each with its story.',
      },
      es: {
        q: '¿Qué colecciona un museo de Zagreb?',
        right: 'Restos de rupturas',
        wrong: ['Calcetines perdidos', 'Malos olores', 'Bigotes falsos'],
        fact: 'El Museo de las Relaciones Rotas: objetos donados de amores fallidos, cada uno con su historia.',
      },
    },
  },
  {
    id: 'chess-boxing',
    text: {
      en: {
        q: 'Which of these is a real sport?',
        right: 'Chess boxing',
        wrong: ['Ice-cream fencing', 'Trampoline darts', 'Sofa rowing'],
        fact: 'Rounds alternate between chess and boxing. You win by checkmate or by knockout.',
      },
      es: {
        q: '¿Cuál de estos es un deporte real?',
        right: 'Ajedrez-boxeo',
        wrong: ['Esgrima con helados', 'Dardos saltarines', 'Remo en sofá'],
        fact: 'Se alternan asaltos de ajedrez y de boxeo. Ganas por jaque mate o por K.O.',
      },
    },
  },
  {
    id: 'spain-anthem',
    text: {
      en: {
        q: 'What’s unusual about Spain’s national anthem?',
        right: 'It has no lyrics',
        wrong: ['It lasts 20 minutes', 'It’s in Latin', 'It’s whistled'],
        fact: 'The Marcha Real has no official words, so stadiums just go “lo-lo-lo”.',
      },
      es: {
        q: '¿Qué tiene de raro el himno nacional de España?',
        right: 'No tiene letra',
        wrong: ['Dura 20 minutos', 'Está en latín', 'Se silba'],
        fact: 'La Marcha Real no tiene letra oficial. De ahí el famoso “lo, lo, lo”.',
      },
    },
  },
  {
    id: 'iceland-mosquito',
    text: {
      en: {
        q: 'Which country has no mosquitoes?',
        right: 'Iceland',
        wrong: ['Spain', 'Brazil', 'Japan'],
        fact: 'Nobody is sure why. The freeze-and-thaw cycles may kill their larvae.',
      },
      es: {
        q: '¿Qué país no tiene mosquitos?',
        right: 'Islandia',
        wrong: ['España', 'Brasil', 'Japón'],
        fact: 'Nadie sabe bien por qué. Quizá los ciclos de hielo y deshielo maten sus larvas.',
      },
    },
  },
  {
    id: 'eiffel-summer',
    text: {
      en: {
        q: 'What happens to the Eiffel Tower in summer?',
        right: 'It grows ~15 cm',
        wrong: ['It leans 1 metre', 'It changes colour', 'It hums at night'],
        fact: 'The iron expands in the heat, so the tower stretches up to about 15 cm.',
      },
      es: {
        q: '¿Qué le pasa a la Torre Eiffel en verano?',
        right: 'Crece unos 15 cm',
        wrong: ['Se inclina 1 metro', 'Cambia de color', 'Zumba de noche'],
        fact: 'El hierro se dilata con el calor y la torre se estira hasta unos 15 cm.',
      },
    },
  },
  // --- Science and space -------------------------------------------------------------------------------
  {
    id: 'banana-berry',
    text: {
      en: {
        q: 'Botanically, which of these is a berry?',
        right: 'Banana',
        wrong: ['Strawberry', 'Raspberry', 'Blackberry'],
        fact: 'Bananas are true berries. Strawberries, raspberries and blackberries aren’t.',
      },
      es: {
        q: 'Botánicamente, ¿cuál de estas es una baya?',
        right: 'El plátano',
        wrong: ['La fresa', 'La frambuesa', 'La mora'],
        fact: 'El plátano es una baya de verdad. La fresa, la frambuesa y la mora, no.',
      },
    },
  },
  {
    id: 'venus-day',
    text: {
      en: {
        q: 'Which planet takes longer to spin once than to circle the Sun?',
        right: 'Venus',
        wrong: ['Mars', 'Jupiter', 'Neptune'],
        fact: 'Venus: 243 Earth days per spin, 225 per orbit. And it spins backwards.',
      },
      es: {
        q: '¿Qué planeta tarda más en girar sobre sí mismo que en dar la vuelta al Sol?',
        right: 'Venus',
        wrong: ['Marte', 'Júpiter', 'Neptuno'],
        fact: 'Venus: 243 días terrestres por giro y 225 por órbita. Y encima gira al revés.',
      },
    },
  },
  {
    id: 'saturn-float',
    text: {
      en: {
        q: 'Which planet would float in a giant bathtub?',
        right: 'Saturn',
        wrong: ['Jupiter', 'Mars', 'Neptune'],
        fact: 'Saturn is less dense than water. Finding the bathtub is the hard part.',
      },
      es: {
        q: '¿Qué planeta flotaría en una bañera gigante?',
        right: 'Saturno',
        wrong: ['Júpiter', 'Marte', 'Neptuno'],
        fact: 'Saturno es menos denso que el agua. Lo difícil es encontrar la bañera.',
      },
    },
  },
  {
    id: 'trees-stars',
    text: {
      en: {
        q: 'There are more trees on Earth than…',
        right: 'Stars in our galaxy',
        wrong: ['Ants on Earth', 'Cells in your body', 'Grains of sand'],
        fact: 'About 3 trillion trees vs. 100–400 billion stars in the Milky Way.',
      },
      es: {
        q: 'En la Tierra hay más árboles que…',
        right: 'Estrellas en la galaxia',
        wrong: ['Hormigas', 'Células en tu cuerpo', 'Granos de arena'],
        fact: 'Unos 3 billones de árboles frente a 100.000–400.000 millones de estrellas en la Vía Láctea.',
      },
    },
  },
  {
    id: 'astronaut-height',
    text: {
      en: {
        q: 'What happens to astronauts’ height in space?',
        right: 'They grow a few cm',
        wrong: ['They shrink', 'Nothing at all', 'Only their feet grow'],
        fact: 'With no gravity the spine stretches out. Back on Earth, it shrinks again.',
      },
      es: {
        q: '¿Qué le pasa a la altura de los astronautas en el espacio?',
        right: 'Crecen unos cm',
        wrong: ['Encogen', 'Nada de nada', 'Solo crecen los pies'],
        fact: 'Sin gravedad, la columna se estira. Al volver a la Tierra, se encoge otra vez.',
      },
    },
  },
  // --- Wordplay (a different question per language) -----------------------------------------------------
  {
    id: 'tittle',
    text: {
      en: {
        q: 'The dot over a lowercase “i” is called a…',
        right: 'Tittle',
        wrong: ['Dottle', 'Twinkle', 'Pimple'],
        fact: 'From Latin “titulus”. A “dottle”, by the way, is the ash left in a pipe.',
      },
      es: {
        q: '¿Cómo se llama la rayita de la ñ?',
        right: 'Virgulilla',
        wrong: ['Culebrilla', 'Bigotillo', 'Gusanito'],
        fact: 'Además de “tilde”, la RAE la llama virgulilla, igual que al apóstrofo o a la cedilla.',
      },
    },
  },
]
