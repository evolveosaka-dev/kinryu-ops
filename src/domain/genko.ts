// 朝礼原稿 (資料③). Spoken lines stay Japanese; `{漢字|かな}` marks furigana.
// `key` points to the translation in the `genko` namespace (lines.*).
import type { ChoreiStep } from './types'

export interface SpokenLine {
  ja: string
  romaji: string
  key: string
  /** say it twice (接客用語 practice) */
  twice?: boolean
}

export interface GenkoStep {
  id: ChoreiStep
  seconds: number | null
  leader: SpokenLine[]
  all: SpokenLine[]
}

export const PREP_QUESTION: SpokenLine = {
  ja: '{仕入|しい}れが{必要|ひつよう}なものはありますか？',
  romaji: 'Shiire ga hitsuyō na mono wa arimasu ka?',
  key: 'lines.prepQuestion',
}

const PHRASES: SpokenLine[] = [
  { ja: 'いらっしゃい！', romaji: 'Irasshai!', key: 'lines.irasshai' },
  { ja: 'まいど！', romaji: 'Maido!', key: 'lines.maido' },
  { ja: 'お{待|ま}たせしました！', romaji: 'Omatase shimashita!', key: 'lines.omatase' },
  { ja: 'おおきに！', romaji: 'Ōkini!', key: 'lines.ookini' },
]

export const GENKO_STEPS: GenkoStep[] = [
  {
    id: 'greeting',
    seconds: null,
    leader: [{ ja: 'これから{朝礼|ちょうれい}を{始|はじ}めます。おはようございます！', romaji: 'Kore kara chōrei o hajimemasu. Ohayō gozaimasu!', key: 'lines.start' }],
    all: [{ ja: 'おはようございます！', romaji: 'Ohayō gozaimasu!', key: 'lines.ohayo' }],
  },
  {
    id: 'philosophy',
    seconds: 30,
    leader: [{ ja: '{経営理念|けいえいりねん}、{唱和|しょうわ}します。', romaji: 'Keiei rinen, shōwa shimasu.', key: 'lines.philosophyStart' }],
    all: [
      { ja: '① お{客様|きゃくさま}{第一|だいいち}！', romaji: 'Okyakusama daiichi!', key: 'lines.philosophy1' },
      { ja: '② {笑顔|えがお}で{元気|げんき}に！', romaji: 'Egao de genki ni!', key: 'lines.philosophy2' },
      { ja: '③ お{客様|きゃくさま}に{最高|さいこう}の{思|おも}い{出|で}を！', romaji: 'Okyakusama ni saikō no omoide o!', key: 'lines.philosophy3' },
    ],
  },
  {
    id: 'phrases',
    seconds: 60,
    leader: [
      { ja: '{接客用語|せっきゃくようご}、{練習|れんしゅう}します。{笑顔|えがお}でお{願|ねが}いします。', romaji: 'Sekkyaku yōgo, renshū shimasu. Egao de onegai shimasu.', key: 'lines.phrasesStart' },
      ...PHRASES,
    ],
    all: PHRASES.map((p) => ({ ...p, twice: true })),
  },
  {
    id: 'handover',
    seconds: 120,
    leader: [
      { ja: '{引継|ひきつ}ぎをします。', romaji: 'Hikitsugi o shimasu.', key: 'lines.handoverStart' },
      { ja: '①{在庫|ざいこ}です。{仕入|しい}れが{必要|ひつよう}なものは〇〇です。（または「ありません。」）', romaji: 'Zaiko desu. Shiire ga hitsuyō na mono wa ○○ desu. (Arimasen.)', key: 'lines.handoverStock' },
      { ja: '②{目標|もくひょう}です。このシフトの{目標|もくひょう}は〇〇{杯|はい}です。', romaji: 'Mokuhyō desu. Kono shifuto no mokuhyō wa ○○ hai desu.', key: 'lines.handoverTarget' },
      { ja: '③{注意点|ちゅういてん}です。〇〇〇〇。', romaji: 'Chūiten desu. ○○○○.', key: 'lines.handoverCaution' },
      { ja: '{質問|しつもん}はありますか？', romaji: 'Shitsumon wa arimasu ka?', key: 'lines.questions' },
    ],
    all: [{ ja: 'ありません！', romaji: 'Arimasen!', key: 'lines.noQuestions' }],
  },
  {
    id: 'grooming',
    seconds: 30,
    leader: [
      {
        ja: '{身|み}だしなみを{確認|かくにん}します。{制服|せいふく}、{三角巾|さんかくきん}、{髪|かみ}、{爪|つめ}、アクセサリー。',
        romaji: 'Midashinami o kakunin shimasu. Seifuku, sankakukin, kami, tsume, akusesarī.',
        key: 'lines.groomingStart',
      },
    ],
    all: [{ ja: '{大丈夫|だいじょうぶ}です！', romaji: 'Daijōbu desu!', key: 'lines.ok' }],
  },
  {
    id: 'closing',
    seconds: 15,
    leader: [{ ja: '{今日|きょう}もよろしくお{願|ねが}いします！', romaji: 'Kyō mo yoroshiku onegai shimasu!', key: 'lines.closing' }],
    all: [{ ja: 'よろしくお{願|ねが}いします！', romaji: 'Yoroshiku onegai shimasu!', key: 'lines.closingAll' }],
  },
]

export interface RubySegment {
  text: string
  reading?: string
}

/** Split "{朝礼|ちょうれい}を始め" into ruby segments. */
export function parseRuby(source: string): RubySegment[] {
  const out: RubySegment[] = []
  const re = /\{([^|}]+)\|([^}]+)\}/g
  let last = 0
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m.index > last) out.push({ text: source.slice(last, m.index) })
    out.push({ text: m[1]!, reading: m[2]! })
    last = re.lastIndex
  }
  if (last < source.length) out.push({ text: source.slice(last) })
  return out
}

/** Plain Japanese without furigana marks. */
export function plainJa(source: string): string {
  return parseRuby(source)
    .map((s) => s.text)
    .join('')
}
