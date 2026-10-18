// Web push texts in the 6 app languages (labels copied from src/locales).
// Labels (shift / change kind / incident kind) are copies of src/locales — src/lib/pushText.test.ts checks they still match.
export const PUSH_LOCALES = ['ja', 'en', 'vi', 'ne', 'si', 'my'] as const
export type PushLocale = (typeof PUSH_LOCALES)[number]

export const PUSH_LABELS: Record<PushLocale, { shift: Record<string, string>; change: Record<string, string>; incident: Record<string, string> }> = {
  "ja": {
    "shift": {
      "early": "早番",
      "middle": "中番",
      "late": "遅番"
    },
    "change": {
      "absence": "休む",
      "late": "遅れる",
      "early_leave": "早退する"
    },
    "incident": {
      "complaint": "お客様のクレーム",
      "injury": "ケガ・事故",
      "foreign_object": "異物混入",
      "equipment": "設備の故障",
      "food_poisoning": "食中毒の疑い",
      "lost_item": "忘れ物・落とし物",
      "phone_message": "電話の伝言",
      "payment": "会計・券売機故障",
      "other": "その他"
    }
  },
  "en": {
    "shift": {
      "early": "Morning shift",
      "middle": "Evening shift",
      "late": "Night shift"
    },
    "change": {
      "absence": "Day off",
      "late": "Late",
      "early_leave": "Leave early"
    },
    "incident": {
      "complaint": "Customer complaint",
      "injury": "Injury / accident",
      "foreign_object": "Foreign object",
      "equipment": "Broken equipment",
      "food_poisoning": "Suspected food poisoning",
      "lost_item": "Lost item",
      "phone_message": "Phone message",
      "payment": "Payment / ticket machine",
      "other": "Other"
    }
  },
  "vi": {
    "shift": {
      "early": "Ca sáng",
      "middle": "Ca chiều tối",
      "late": "Ca đêm"
    },
    "change": {
      "absence": "Nghỉ",
      "late": "Đi muộn",
      "early_leave": "Về sớm"
    },
    "incident": {
      "complaint": "Khách khiếu nại",
      "injury": "Chấn thương / tai nạn",
      "foreign_object": "Dị vật",
      "equipment": "Hỏng thiết bị",
      "food_poisoning": "Nghi ngộ độc thực phẩm",
      "lost_item": "Đồ để quên / rơi",
      "phone_message": "Lời nhắn qua điện thoại",
      "payment": "Sự cố thanh toán / máy bán vé",
      "other": "Khác"
    }
  },
  "ne": {
    "shift": {
      "early": "बिहानको सिफ्ट",
      "middle": "साँझको सिफ्ट",
      "late": "रातको सिफ्ट"
    },
    "change": {
      "absence": "बिदा",
      "late": "ढिलो",
      "early_leave": "चाँडो जाने"
    },
    "incident": {
      "complaint": "ग्राहकको गुनासो",
      "injury": "चोट / दुर्घटना",
      "foreign_object": "बाहिरी वस्तु मिसिएको",
      "equipment": "उपकरण बिग्रिएको",
      "food_poisoning": "खाना विषाक्तताको शंका",
      "lost_item": "छुटेको / हराएको सामान",
      "phone_message": "फोन सन्देश",
      "payment": "भुक्तानी / टिकट मेसिन समस्या",
      "other": "अन्य"
    }
  },
  "si": {
    "shift": {
      "early": "උදේ ෂිෆ්ට්",
      "middle": "සවස ෂිෆ්ට්",
      "late": "රාත්‍රී ෂිෆ්ට්"
    },
    "change": {
      "absence": "නිවාඩු",
      "late": "ප්‍රමාද",
      "early_leave": "කලින් යාම"
    },
    "incident": {
      "complaint": "පාරිභෝගික පැමිණිල්ල",
      "injury": "තුවාල / අනතුර",
      "foreign_object": "බාහිර ද්‍රව්‍ය",
      "equipment": "උපකරණ දෝෂය",
      "food_poisoning": "ආහාර විෂ වීමේ සැකය",
      "lost_item": "අමතක වූ / නැති වූ දේ",
      "phone_message": "දුරකථන පණිවිඩය",
      "payment": "ගෙවීම / ටිකට් යන්ත්‍ර ගැටලු",
      "other": "වෙනත්"
    }
  },
  "my": {
    "shift": {
      "early": "နံနက်ဆိုင်း",
      "middle": "ညနေဆိုင်း",
      "late": "ညဆိုင်း"
    },
    "change": {
      "absence": "ခွင့်ယူမည်",
      "late": "နောက်ကျမည်",
      "early_leave": "စောပြန်မည်"
    },
    "incident": {
      "complaint": "ဧည့်သည်၏ တိုင်ကြားချက်",
      "injury": "ဒဏ်ရာ / မတော်တဆမှု",
      "foreign_object": "အညစ်အကြေး ပါဝင်ခြင်း",
      "equipment": "စက်ပစ္စည်း ပျက်ခြင်း",
      "food_poisoning": "အစာအဆိပ်သင့်မှု သံသယ",
      "lost_item": "ပစ္စည်း ကျန်ခဲ့ခြင်း",
      "phone_message": "ဖုန်း မှာကြားချက်",
      "payment": "ငွေရှင်းခြင်း / လက်မှတ်ရောင်းစက်",
      "other": "အခြား"
    }
  }
}

export const PUSH_TEXT: Record<PushLocale, Record<string, string[]>> = {
  "ja": {
    "dow": [
      "日",
      "月",
      "火",
      "水",
      "木",
      "金",
      "土"
    ],
    "test": [
      "🔔 テスト通知",
      "通知は届いています。"
    ],
    "recruit": [
      "🙋 代わりの人を探しています",
      "{date} {shift} {time} {store}。入れる人はアプリで「代われます」を押してください。"
    ],
    "named": [
      "🤝 {name}さんがあなたを代わりの人に指名しました",
      "{date} {shift} {time}。管理者の承認を待っています。"
    ],
    "decided_ok": [
      "✅ 承認されました",
      "{date} {shift}：{kind}"
    ],
    "decided_ng": [
      "❌ 承認されませんでした",
      "{date} {shift}：{kind}。アプリで管理者のコメントを見てください。"
    ],
    "assigned": [
      "✅ 代わりに入ることが決まりました",
      "{date} {shift} {time}（{name}さんの代わり）"
    ],
    "upload": [
      "📤 送れていない写真・動画があります（{n}件）",
      "アプリを開いて、送り終わるまで開いたままにしてください。"
    ],
    "mgr_report": [
      "🙋 {name}：{kind}",
      "{date} {shift} {time}。承認してください。"
    ],
    "mgr_offer": [
      "🙋 {offer}さんが代われます",
      "{name}さんの {date} {shift}。承認してください。"
    ],
    "mgr_reminder": [
      "⏰ まだ承認されていません（あと{h}時間）",
      "{name}：{kind} {date} {shift}"
    ],
    "mgr_created": [
      "⚠️ クレーム・事故：{kind}",
      "アプリで内容を確認してください。"
    ],
    "mgr_overdue": [
      "⏰ 期限を過ぎたクレーム・事故",
      "{kind}。アプリで対応してください。"
    ],
    "mgr_signup": [
      "👤 新しい登録があります",
      "アプリで承認してください。"
    ]
  },
  "en": {
    "dow": [
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat"
    ],
    "test": [
      "🔔 Test notification",
      "Notifications are working."
    ],
    "recruit": [
      "🙋 Someone is needed to cover a shift",
      "{date} {shift} {time} {store}. If you can work, tap \"I can cover\" in the app."
    ],
    "named": [
      "🤝 {name} named you to cover their shift",
      "{date} {shift} {time}. Waiting for a manager to approve."
    ],
    "decided_ok": [
      "✅ Approved",
      "{date} {shift}: {kind}"
    ],
    "decided_ng": [
      "❌ Not approved",
      "{date} {shift}: {kind}. See the manager's comment in the app."
    ],
    "assigned": [
      "✅ You will cover this shift",
      "{date} {shift} {time} (for {name})"
    ],
    "upload": [
      "📤 Photos / videos not sent yet ({n})",
      "Open the app and keep it open until sending is finished."
    ],
    "mgr_report": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}. Please approve."
    ],
    "mgr_offer": [
      "🙋 {offer} can cover",
      "{name}'s {date} {shift}. Please approve."
    ],
    "mgr_reminder": [
      "⏰ Still not approved ({h} h left)",
      "{name}: {kind} {date} {shift}"
    ],
    "mgr_created": [
      "⚠️ Complaint / accident: {kind}",
      "Check the details in the app."
    ],
    "mgr_overdue": [
      "⏰ Complaint / accident past its deadline",
      "{kind}. Please handle it in the app."
    ],
    "mgr_signup": [
      "👤 New sign-up",
      "Please approve it in the app."
    ]
  },
  "vi": {
    "dow": [
      "CN",
      "T2",
      "T3",
      "T4",
      "T5",
      "T6",
      "T7"
    ],
    "test": [
      "🔔 Thông báo thử",
      "Thông báo đã đến máy của bạn."
    ],
    "recruit": [
      "🙋 Đang tìm người làm thay",
      "{date} {shift} {time} {store}. Ai làm được thì bấm \"Tôi làm thay được\" trong app."
    ],
    "named": [
      "🤝 {name} đã chọn bạn làm thay",
      "{date} {shift} {time}. Đang chờ quản lý duyệt."
    ],
    "decided_ok": [
      "✅ Đã được duyệt",
      "{date} {shift}: {kind}"
    ],
    "decided_ng": [
      "❌ Không được duyệt",
      "{date} {shift}: {kind}. Xem ghi chú của quản lý trong app."
    ],
    "assigned": [
      "✅ Bạn sẽ làm thay ca này",
      "{date} {shift} {time} (thay cho {name})"
    ],
    "upload": [
      "📤 Còn ảnh / video chưa gửi được ({n})",
      "Hãy mở app và để app mở cho đến khi gửi xong."
    ],
    "mgr_report": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}. Vui lòng duyệt."
    ],
    "mgr_offer": [
      "🙋 {offer} làm thay được",
      "Ca {date} {shift} của {name}. Vui lòng duyệt."
    ],
    "mgr_reminder": [
      "⏰ Vẫn chưa được duyệt (còn {h} giờ)",
      "{name}: {kind} {date} {shift}"
    ],
    "mgr_created": [
      "⚠️ Khiếu nại / sự cố: {kind}",
      "Hãy xem nội dung trong app."
    ],
    "mgr_overdue": [
      "⏰ Khiếu nại / sự cố đã quá hạn",
      "{kind}. Hãy xử lý trong app."
    ],
    "mgr_signup": [
      "👤 Có người đăng ký mới",
      "Vui lòng duyệt trong app."
    ]
  },
  "ne": {
    "dow": [
      "आइत",
      "सोम",
      "मंगल",
      "बुध",
      "बिही",
      "शुक्र",
      "शनि"
    ],
    "test": [
      "🔔 परीक्षण सूचना",
      "सूचना आइपुगेको छ।"
    ],
    "recruit": [
      "🙋 सिफ्टमा सट्टा काम गर्ने मान्छे चाहिएको छ",
      "{date} {shift} {time} {store}। काम गर्न सक्नुहुन्छ भने एपमा \"म सट्टा गर्न सक्छु\" थिच्नुहोस्।"
    ],
    "named": [
      "🤝 {name} ले तपाईंलाई सट्टा काम गर्न छान्नुभयो",
      "{date} {shift} {time}। म्यानेजरको स्वीकृति पर्खँदै।"
    ],
    "decided_ok": [
      "✅ स्वीकृत भयो",
      "{date} {shift}: {kind}"
    ],
    "decided_ng": [
      "❌ स्वीकृत भएन",
      "{date} {shift}: {kind}। एपमा म्यानेजरको टिप्पणी हेर्नुहोस्।"
    ],
    "assigned": [
      "✅ तपाईंले यो सिफ्ट सट्टा काम गर्नुहुनेछ",
      "{date} {shift} {time} ({name} को सट्टा)"
    ],
    "upload": [
      "📤 पठाउन नसकिएका फोटो / भिडियो छन् ({n})",
      "एप खोल्नुहोस् र पठाउने काम नसकिएसम्म खुला राख्नुहोस्।"
    ],
    "mgr_report": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}। कृपया स्वीकृत गर्नुहोस्।"
    ],
    "mgr_offer": [
      "🙋 {offer} सट्टा गर्न सक्नुहुन्छ",
      "{name} को {date} {shift}। कृपया स्वीकृत गर्नुहोस्।"
    ],
    "mgr_reminder": [
      "⏰ अझै स्वीकृत भएको छैन ({h} घण्टा बाँकी)",
      "{name}: {kind} {date} {shift}"
    ],
    "mgr_created": [
      "⚠️ गुनासो / दुर्घटना: {kind}",
      "एपमा विवरण हेर्नुहोस्।"
    ],
    "mgr_overdue": [
      "⏰ म्याद नाघेको गुनासो / दुर्घटना",
      "{kind}। एपमा काम गर्नुहोस्।"
    ],
    "mgr_signup": [
      "👤 नयाँ दर्ता छ",
      "एपमा स्वीकृत गर्नुहोस्।"
    ]
  },
  "si": {
    "dow": [
      "ඉරි",
      "සඳු",
      "අඟ",
      "බදා",
      "බ්‍රහ",
      "සිකු",
      "සෙන"
    ],
    "test": [
      "🔔 පරීක්ෂණ දැනුම්දීම",
      "දැනුම්දීම් ලැබෙනවා."
    ],
    "recruit": [
      "🙋 ෂිෆ්ට් එකට වෙනුවට වැඩ කරන කෙනෙක් අවශ්‍යයි",
      "{date} {shift} {time} {store}. වැඩ කළ හැකි නම් ඇප් එකේ \"මට වෙනුවට වැඩ කළ හැක\" ඔබන්න."
    ],
    "named": [
      "🤝 {name} ඔබව වෙනුවට වැඩ කිරීමට තෝරා ගත්තා",
      "{date} {shift} {time}. කළමනාකරුගේ අනුමැතිය බලාපොරොත්තුවෙන්."
    ],
    "decided_ok": [
      "✅ අනුමත කළා",
      "{date} {shift}: {kind}"
    ],
    "decided_ng": [
      "❌ අනුමත කළේ නැහැ",
      "{date} {shift}: {kind}. ඇප් එකේ කළමනාකරුගේ සටහන බලන්න."
    ],
    "assigned": [
      "✅ ඔබ මෙම ෂිෆ්ට් එකට වෙනුවට වැඩ කරනවා",
      "{date} {shift} {time} ({name} වෙනුවට)"
    ],
    "upload": [
      "📤 යැවිය නොහැකි වූ ඡායාරූප / වීඩියෝ ඇත ({n})",
      "ඇප් එක විවෘත කර යවා අවසන් වන තුරු විවෘතව තබන්න."
    ],
    "mgr_report": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}. කරුණාකර අනුමත කරන්න."
    ],
    "mgr_offer": [
      "🙋 {offer}ට වෙනුවට කළ හැක",
      "{name}ගේ {date} {shift}. කරුණාකර අනුමත කරන්න."
    ],
    "mgr_reminder": [
      "⏰ තවමත් අනුමත කර නැත (පැය {h} ඉතිරියි)",
      "{name}: {kind} {date} {shift}"
    ],
    "mgr_created": [
      "⚠️ පැමිණිල්ල / අනතුර: {kind}",
      "ඇප් එකේ විස්තර බලන්න."
    ],
    "mgr_overdue": [
      "⏰ කාලය ඉක්මවූ පැමිණිල්ල / අනතුර",
      "{kind}. ඇප් එකේ කටයුතු කරන්න."
    ],
    "mgr_signup": [
      "👤 නව ලියාපදිංචියක් ඇත",
      "ඇප් එකේ අනුමත කරන්න."
    ]
  },
  "my": {
    "dow": [
      "တနင်္ဂနွေ",
      "တနင်္လာ",
      "အင်္ဂါ",
      "ဗုဒ္ဓဟူး",
      "ကြာသပတေး",
      "သောကြာ",
      "စနေ"
    ],
    "test": [
      "🔔 စမ်းသပ် အသိပေးချက်",
      "အသိပေးချက် ရောက်ရှိပါသည်။"
    ],
    "recruit": [
      "🙋 ဆိုင်းအစားဝင်မည့်သူ လိုအပ်ပါသည်",
      "{date} {shift} {time} {store}။ ဝင်နိုင်လျှင် အက်ပ်တွင် \"ကျွန်ုပ် အစားထိုးနိုင်သည်\" ကို နှိပ်ပါ။"
    ],
    "named": [
      "🤝 {name} က သင့်ကို အစားဝင်ရန် ရွေးထားပါသည်",
      "{date} {shift} {time}။ မန်နေဂျာ၏ ခွင့်ပြုချက်ကို စောင့်နေပါသည်။"
    ],
    "decided_ok": [
      "✅ ခွင့်ပြုပြီးပါပြီ",
      "{date} {shift}: {kind}"
    ],
    "decided_ng": [
      "❌ ခွင့်မပြုပါ",
      "{date} {shift}: {kind}။ အက်ပ်တွင် မန်နေဂျာ၏ မှတ်ချက်ကို ကြည့်ပါ။"
    ],
    "assigned": [
      "✅ ဤဆိုင်းကို သင် အစားဝင်ရပါမည်",
      "{date} {shift} {time} ({name} ၏ အစား)"
    ],
    "upload": [
      "📤 မပို့ရသေးသော ဓာတ်ပုံ / ဗီဒီယို ရှိပါသည် ({n})",
      "အက်ပ်ကိုဖွင့်ပြီး ပို့ပြီးသည်အထိ ဖွင့်ထားပါ။"
    ],
    "mgr_report": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}။ ခွင့်ပြုပေးပါ။"
    ],
    "mgr_offer": [
      "🙋 {offer} အစားဝင်နိုင်ပါသည်",
      "{name} ၏ {date} {shift}။ ခွင့်ပြုပေးပါ။"
    ],
    "mgr_reminder": [
      "⏰ မခွင့်ပြုရသေးပါ ({h} နာရီ ကျန်)",
      "{name}: {kind} {date} {shift}"
    ],
    "mgr_created": [
      "⚠️ တိုင်ကြားချက် / မတော်တဆမှု: {kind}",
      "အက်ပ်တွင် အသေးစိတ်ကို ကြည့်ပါ။"
    ],
    "mgr_overdue": [
      "⏰ သတ်မှတ်ချိန်ကျော်သော တိုင်ကြားချက် / မတော်တဆမှု",
      "{kind}။ အက်ပ်တွင် ဆောင်ရွက်ပါ။"
    ],
    "mgr_signup": [
      "👤 စာရင်းသွင်းသူအသစ် ရှိပါသည်",
      "အက်ပ်တွင် ခွင့်ပြုပေးပါ။"
    ]
  }
}

export interface PushData {
  [key: string]: unknown
}

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '')
const hm = (m: number) => `${Math.floor((m % 1440) / 60)}:${String(m % 60).padStart(2, '0')}`

/** Title and body of one notification for a person reading `locale`. */
export function pushMessage(kind: string, data: PushData, locale: string): { title: string; body: string } {
  const loc: PushLocale = (PUSH_LOCALES as readonly string[]).includes(locale) ? (locale as PushLocale) : 'ja'
  const t = PUSH_TEXT[loc]
  const L = PUSH_LABELS[loc]
  const str = (k: string) => (data[k] == null ? '' : String(data[k]))
  let date = ''
  if (typeof data.date === 'string') {
    const d = new Date(`${data.date}T00:00:00Z`)
    date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${t.dow![d.getUTCDay()]})`
  }
  const v: Record<string, string> = {
    date,
    shift: L.shift[str('shift')] ?? str('shift'),
    time: typeof data.from === 'number' && typeof data.to === 'number' ? `${hm(data.from)}–${hm(data.to)}` : '',
    store: str('store'),
    name: str('name'),
    offer: str('offer_name'),
    n: str('n'),
    h: str('hours'),
    kind: kind === 'mgr_incident' ? (L.incident[str('kind')] ?? str('kind')) : (L.change[str('kind')] ?? str('kind')),
  }
  const key =
    kind === 'decided' ? (data.ok ? 'decided_ok' : 'decided_ng')
    : kind === 'mgr_change' ? (data.event === 'offer' ? 'mgr_offer' : data.event === 'reminder' ? 'mgr_reminder' : 'mgr_report')
    : kind === 'mgr_incident' ? (data.event === 'overdue' ? 'mgr_overdue' : 'mgr_created')
    : kind
  const [title, body] = t[key] ?? t.test!
  return { title: fill(title!, v).replace(/\s+/g, ' ').trim(), body: fill(body!, v).replace(/\s+([。.,、])/g, '$1').replace(/\s+/g, ' ').trim() }
}
