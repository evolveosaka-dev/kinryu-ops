// Phrases staff actually say. They always stay in Japanese (CLAUDE.md §8);
// the translation key points into the `common` namespace.

export interface Phrase {
  ja: string
  romaji: string
  key: string
}

export const PHILOSOPHY: Phrase[] = [
  { ja: '① お客様第一！', romaji: 'Okyakusama daiichi!', key: 'phrase.philosophy1' },
  { ja: '② 笑顔で元気に！', romaji: 'Egao de genki ni!', key: 'phrase.philosophy2' },
  { ja: '③ お客様に最高の思い出を！', romaji: 'Okyakusama ni saikō no omoide o!', key: 'phrase.philosophy3' },
]

export const SERVICE_PHRASES: Phrase[] = [
  { ja: 'いらっしゃい！', romaji: 'Irasshai!', key: 'phrase.irasshai' },
  { ja: 'まいど！', romaji: 'Maido!', key: 'phrase.maido' },
  { ja: 'お待たせしました！', romaji: 'Omatase shimashita!', key: 'phrase.omatase' },
  { ja: 'おおきに！', romaji: 'Ōkini!', key: 'phrase.ookini' },
]

/** 注意点 quick-picks (same list as the 朝礼原稿). Stored in Japanese. */
export const CAUTION_PICKS: Phrase[] = [
  { ja: 'いらっしゃいは3秒以内に、全員で言いましょう。', romaji: 'Irasshai wa san-byō inai ni, zen-in de iimashō.', key: 'pick.0' },
  { ja: 'お客様が帰るとき、全員で『おおきに』を言いましょう。', romaji: "Okyakusama ga kaeru toki, zen-in de 'ōkini' o iimashō.", key: 'pick.1' },
  { ja: '食券を受け取ったら、『まいど！』と言いましょう。', romaji: "Shokken o uketottara, 'maido!' to iimashō.", key: 'pick.8' },
  { ja: 'お客様の目を見て、笑顔で話しましょう。', romaji: 'Okyakusama no me o mite, egao de hanashimashō.', key: 'pick.2' },
  { ja: '海外のお客様の場合、写真の手伝いしましょう。', romaji: 'Kaigai no okyakusama no baai, shashin no tetsudai shimashō.', key: 'pick.3' },
  { ja: 'スープの量を見本の線までそろえましょう。', romaji: 'Sūpu no ryō o mihon no sen made soroemashō.', key: 'pick.4' },
  { ja: '丼の縁をきれいにしてから出しましょう。', romaji: 'Donburi no fuchi o kirei ni shite kara dashimashō.', key: 'pick.5' },
  { ja: '混む前に、箸と紙ナプキンを補充しましょう。', romaji: 'Komu mae ni, hashi to kami napukin o hojū shimashō.', key: 'pick.6' },
  { ja: '床がぬれているので、気をつけましょう。', romaji: 'Yuka ga nurete iru node, ki o tsukemashō.', key: 'pick.7' },
]
