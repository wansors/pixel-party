import type { QuizEntry } from './quizCore'

// Lightning Quiz question bank: quick general knowledge, written natively in each language (D24's
// bilingual format). Every answer has exactly one right option: questions whose answer depends on the
// convention (how many continents there are, which colors are "primary") stay out. Budgets (checked by
// the quiz tests): a question fits the board, a choice fits a tile (≤ 24 chars).

const q = (
  id: string,
  en: [string, string, string, string, string],
  es: [string, string, string, string, string],
): QuizEntry => ({
  id,
  text: {
    en: { q: en[0], right: en[1], wrong: [en[2], en[3], en[4]] },
    es: { q: es[0], right: es[1], wrong: [es[2], es[3], es[4]] },
  },
})

// Each row: [question, right answer, three decoys] per language.
export const TRIVIA_BANK: readonly QuizEntry[] = [
  // --- Geography -------------------------------------------------------------------------------------
  q(
    'capital-japan',
    ['What is the capital of Japan?', 'Tokyo', 'Seoul', 'Beijing', 'Bangkok'],
    ['¿Cuál es la capital de Japón?', 'Tokio', 'Seúl', 'Pekín', 'Bangkok'],
  ),
  q(
    'capital-australia',
    ['What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
    ['¿Cuál es la capital de Australia?', 'Canberra', 'Sídney', 'Melbourne', 'Perth'],
  ),
  q(
    'capital-canada',
    ['What is the capital of Canada?', 'Ottawa', 'Toronto', 'Vancouver', 'Montreal'],
    ['¿Cuál es la capital de Canadá?', 'Ottawa', 'Toronto', 'Vancouver', 'Montreal'],
  ),
  q(
    'largest-ocean',
    ['What is the largest ocean?', 'Pacific', 'Atlantic', 'Indian', 'Arctic'],
    ['¿Cuál es el océano más grande?', 'El Pacífico', 'El Atlántico', 'El Índico', 'El Ártico'],
  ),
  q(
    'largest-country',
    ['Which is the largest country by area?', 'Russia', 'Canada', 'China', 'The USA'],
    ['¿Cuál es el país más extenso del mundo?', 'Rusia', 'Canadá', 'China', 'Estados Unidos'],
  ),
  q(
    'smallest-country',
    [
      'Which is the smallest country in the world?',
      'Vatican City',
      'Monaco',
      'San Marino',
      'Malta',
    ],
    ['¿Cuál es el país más pequeño del mundo?', 'El Vaticano', 'Mónaco', 'San Marino', 'Malta'],
  ),
  q(
    'highest-mountain',
    ['What is the highest mountain on Earth?', 'Everest', 'K2', 'Kilimanjaro', 'Mont Blanc'],
    [
      '¿Cuál es la montaña más alta de la Tierra?',
      'El Everest',
      'El K2',
      'El Kilimanjaro',
      'El Mont Blanc',
    ],
  ),
  q(
    'sahara',
    ['What is the largest hot desert?', 'The Sahara', 'The Gobi', 'The Kalahari', 'The Atacama'],
    ['¿Cuál es el mayor desierto cálido?', 'El Sáhara', 'El Gobi', 'El Kalahari', 'El de Atacama'],
  ),
  q(
    'italy-boot',
    ['Which country is shaped like a boot?', 'Italy', 'Greece', 'Chile', 'Portugal'],
    ['¿Qué país tiene forma de bota?', 'Italia', 'Grecia', 'Chile', 'Portugal'],
  ),
  q(
    'giza',
    ['The pyramids of Giza are in…', 'Egypt', 'Mexico', 'Peru', 'Sudan'],
    ['Las pirámides de Guiza están en…', 'Egipto', 'México', 'Perú', 'Sudán'],
  ),
  q(
    'sagrada-familia',
    ['In which city is the Sagrada Família?', 'Barcelona', 'Madrid', 'Seville', 'Valencia'],
    [
      '¿Dónde está la Sagrada Familia (que algún día acabarán)?',
      'Barcelona',
      'Madrid',
      'Sevilla',
      'Valencia',
    ],
  ),
  q(
    'statue-liberty',
    ['The Statue of Liberty was a gift from…', 'France', 'Spain', 'The UK', 'Italy'],
    ['La Estatua de la Libertad fue un regalo de…', 'Francia', 'España', 'Reino Unido', 'Italia'],
  ),
  q(
    'uk-currency',
    ['What is the currency of the UK?', 'The pound', 'The euro', 'The dollar', 'The franc'],
    [
      '¿Con qué pagan en el Reino Unido? (El euro, ni en pintura)',
      'La libra',
      'El yen',
      'El dólar',
      'El franco',
    ],
  ),
  q(
    'peseta',
    ['Before the euro, Spain used the…', 'Peseta', 'Lira', 'Escudo', 'Franc'],
    ['Antes del euro, en España pagábamos con…', 'Pesetas', 'Liras', 'Escudos', 'Francos'],
  ),
  // --- Science and nature ----------------------------------------------------------------------------
  q(
    'closest-planet',
    ['Which planet is closest to the Sun?', 'Mercury', 'Venus', 'Mars', 'Earth'],
    ['¿Qué planeta está más cerca del Sol?', 'Mercurio', 'Venus', 'Marte', 'La Tierra'],
  ),
  q(
    'red-planet',
    ['Which planet is known as the Red Planet?', 'Mars', 'Jupiter', 'Venus', 'Saturn'],
    ['¿Qué planeta es conocido como el planeta rojo?', 'Marte', 'Júpiter', 'Venus', 'Saturno'],
  ),
  q(
    'largest-planet',
    ['What is the largest planet in the Solar System?', 'Jupiter', 'Saturn', 'Neptune', 'Earth'],
    [
      '¿Cuál es el planeta más grande del sistema solar?',
      'Júpiter',
      'Saturno',
      'Neptuno',
      'La Tierra',
    ],
  ),
  q(
    'ringed-planet',
    ['Which planet is famous for its rings?', 'Saturn', 'Mars', 'Venus', 'Mercury'],
    ['¿Qué planeta es famoso por sus anillos?', 'Saturno', 'Marte', 'Venus', 'Mercurio'],
  ),
  q(
    'plants-co2',
    ['Which gas do plants take in to make food?', 'Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium'],
    [
      '¿Qué gas usan las plantas para la fotosíntesis?',
      'Dióxido de carbono',
      'Oxígeno',
      'Nitrógeno',
      'Helio',
    ],
  ),
  q(
    'water-formula',
    ['H₂O is the chemical formula for…', 'Water', 'Salt', 'Sugar', 'Ammonia'],
    ['H₂O es la fórmula química del…', 'Agua', 'Sal', 'Azúcar', 'Amoniaco'],
  ),
  q(
    'water-boils',
    ['At sea level, water boils at…', '100 °C', '90 °C', '120 °C', '80 °C'],
    ['Al nivel del mar, el agua hierve a…', '100 °C', '90 °C', '120 °C', '80 °C'],
  ),
  q(
    'water-freezes-f',
    ['Water freezes at what temperature in Fahrenheit?', '32 °F', '0 °F', '100 °F', '212 °F'],
    ['¿A cuántos grados Fahrenheit se congela el agua?', '32 °F', '0 °F', '100 °F', '212 °F'],
  ),
  q(
    'liquid-metal',
    ['Which metal is liquid at room temperature?', 'Mercury', 'Lead', 'Tin', 'Aluminium'],
    [
      '¿Qué metal es líquido a temperatura ambiente?',
      'El mercurio',
      'El plomo',
      'El estaño',
      'El aluminio',
    ],
  ),
  q(
    'gold-symbol',
    ['What is the chemical symbol for gold?', 'Au', 'Ag', 'Go', 'Gd'],
    ['¿Cuál es el símbolo químico del oro?', 'Au', 'Ag', 'Or', 'Go'],
  ),
  q(
    'hardest-mineral',
    ['What is the hardest natural mineral?', 'Diamond', 'Gold', 'Iron', 'Quartz'],
    ['¿Cuál es el mineral natural más duro?', 'El diamante', 'El oro', 'El hierro', 'El cuarzo'],
  ),
  q(
    'spider-legs',
    ['How many legs does a spider have?', '8', '6', '10', '12'],
    ['¿Cuántas patas tiene una araña?', '8', '6', '10', '12'],
  ),
  q(
    'insect-legs',
    ['How many legs does an insect have?', '6', '4', '8', '10'],
    ['¿Cuántas patas tiene un insecto?', '6', '4', '8', '10'],
  ),
  q(
    'fastest-animal',
    ['Which is the fastest land animal?', 'Cheetah', 'Lion', 'Horse', 'Gazelle'],
    [
      '¿Cuál es el animal terrestre más rápido?',
      'El guepardo',
      'El león',
      'El caballo',
      'La gacela',
    ],
  ),
  q(
    'tallest-animal',
    ['Which is the tallest animal?', 'Giraffe', 'Elephant', 'Ostrich', 'Camel'],
    ['¿Cuál es el animal más alto?', 'La jirafa', 'El elefante', 'El avestruz', 'El camello'],
  ),
  q(
    'not-mammal',
    ['Which of these is NOT a mammal?', 'Shark', 'Whale', 'Bat', 'Dolphin'],
    ['¿Cuál de estos NO es un mamífero?', 'El tiburón', 'La ballena', 'El murciélago', 'El delfín'],
  ),
  q(
    'adult-bones',
    ['How many bones does an adult human have?', '206', '106', '306', '186'],
    [
      '¿Cuántos huesos tiene un adulto? Sin contar los que te rompas hoy',
      '206',
      '106',
      '306',
      '186',
    ],
  ),
  q(
    'heart-chambers',
    ['How many chambers does the human heart have?', '4', '2', '3', '6'],
    ['¿Cuántas cavidades tiene el corazón? Hasta el del ex', '4', '2', '3', '6'],
  ),
  q(
    'largest-organ',
    [
      'What is the largest organ of the human body?',
      'The skin',
      'The liver',
      'The brain',
      'The lungs',
    ],
    [
      '¿Cuál es el órgano más grande del cuerpo?',
      'La piel',
      'El hígado',
      'El cerebro',
      'Los pulmones',
    ],
  ),
  q(
    'longest-bone',
    ['What is the longest bone in the body?', 'The femur', 'The tibia', 'The humerus', 'The spine'],
    ['¿Cuál es el hueso más largo del cuerpo?', 'El fémur', 'La tibia', 'El húmero', 'La columna'],
  ),
  q(
    'universal-donor',
    [
      'Which blood type is the universal donor?',
      'O negative',
      'AB positive',
      'A positive',
      'B negative',
    ],
    [
      '¿Qué grupo sanguíneo es el donante universal?',
      '0 negativo',
      'AB positivo',
      'A positivo',
      'B negativo',
    ],
  ),
  q(
    'penicillin',
    [
      'Who discovered penicillin?',
      'Alexander Fleming',
      'Louis Pasteur',
      'Marie Curie',
      'Isaac Newton',
    ],
    [
      '¿Quién descubrió la penicilina?',
      'Alexander Fleming',
      'Louis Pasteur',
      'Marie Curie',
      'Isaac Newton',
    ],
  ),
  // --- History, arts and culture -----------------------------------------------------------------------
  q(
    'columbus',
    ['In what year did Columbus reach America?', '1492', '1592', '1392', '1500'],
    ['¿En qué año llegó Colón a América?', '1492', '1592', '1392', '1500'],
  ),
  q(
    'moon-landing',
    ['In what year did humans first walk on the Moon?', '1969', '1959', '1979', '1965'],
    ['¿En qué año pisó el ser humano la Luna por primera vez?', '1969', '1959', '1979', '1965'],
  ),
  q(
    'ww2-end',
    ['In what year did World War II end?', '1945', '1939', '1918', '1950'],
    ['¿En qué año terminó la Segunda Guerra Mundial?', '1945', '1939', '1918', '1950'],
  ),
  q(
    'berlin-wall',
    ['In what year did the Berlin Wall fall?', '1989', '1991', '1979', '1961'],
    ['¿En qué año cayó el muro de Berlín?', '1989', '1991', '1979', '1961'],
  ),
  q(
    'first-us-president',
    [
      'Who was the first President of the USA?',
      'George Washington',
      'Abraham Lincoln',
      'Thomas Jefferson',
      'John Adams',
    ],
    [
      '¿Quién fue el primer presidente de EE. UU.?',
      'George Washington',
      'Abraham Lincoln',
      'Thomas Jefferson',
      'John Adams',
    ],
  ),
  q(
    'mona-lisa',
    ['Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Picasso'],
    ['¿Quién pintó La Gioconda?', 'Leonardo da Vinci', 'Miguel Ángel', 'Rafael', 'Picasso'],
  ),
  q(
    'guernica',
    ['Who painted Guernica?', 'Picasso', 'Dalí', 'Miró', 'Velázquez'],
    ['¿Quién pintó el Guernica?', 'Picasso', 'Dalí', 'Miró', 'Velázquez'],
  ),
  q(
    'don-quixote',
    ['Who wrote Don Quixote?', 'Cervantes', 'Lope de Vega', 'Shakespeare', 'Quevedo'],
    ['¿Quién escribió El Quijote?', 'Cervantes', 'Lope de Vega', 'Shakespeare', 'Quevedo'],
  ),
  q(
    'romeo-juliet',
    ['Who wrote Romeo and Juliet?', 'Shakespeare', 'Dickens', 'Cervantes', 'Molière'],
    ['¿Quién escribió Romeo y Julieta?', 'Shakespeare', 'Dickens', 'Cervantes', 'Molière'],
  ),
  q(
    'olympic-rings',
    ['How many rings are on the Olympic flag?', '5', '4', '6', '7'],
    ['¿Cuántos aros tiene la bandera olímpica?', '5', '4', '6', '7'],
  ),
  q(
    'world-cup-2010',
    ['Who won the 2010 football World Cup?', 'Spain', 'The Netherlands', 'Germany', 'Brazil'],
    ['¿Quién ganó el Mundial de fútbol de 2010?', 'España', 'Países Bajos', 'Alemania', 'Brasil'],
  ),
  q(
    'mandarin',
    [
      'Which language has the most native speakers?',
      'Mandarin Chinese',
      'English',
      'Spanish',
      'Hindi',
    ],
    [
      '¿Qué idioma tiene más hablantes nativos?',
      'El chino mandarín',
      'El inglés',
      'El español',
      'El hindi',
    ],
  ),
  // --- Numbers ---------------------------------------------------------------------------------------
  q(
    'hexagon-sides',
    ['How many sides does a hexagon have?', '6', '5', '7', '8'],
    ['¿Cuántos lados tiene un hexágono?', '6', '5', '7', '8'],
  ),
  q(
    'piano-keys',
    ['How many keys does a standard piano have?', '88', '76', '92', '100'],
    ['¿Cuántas teclas tiene un piano estándar?', '88', '76', '92', '100'],
  ),
  q(
    'chessboard',
    ['How many squares are on a chessboard?', '64', '36', '81', '100'],
    ['¿Cuántas casillas tiene un tablero de ajedrez?', '64', '36', '81', '100'],
  ),
  q(
    'minutes-day',
    ['How many minutes are in a day?', '1,440', '1,240', '1,600', '960'],
    ['¿Cuántos minutos tiene un día? Sin calculadora, listillo', '1.440', '1.240', '1.600', '960'],
  ),
  q(
    'football-players',
    ['How many players does a football team field?', '11', '10', '9', '12'],
    ['¿Cuántos jugadores tiene un equipo de fútbol en el campo?', '11', '10', '9', '12'],
  ),
]
