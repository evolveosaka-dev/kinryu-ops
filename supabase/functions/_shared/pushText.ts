// Web push texts in the 6 app languages (labels copied from src/locales).
// Labels (shift / change kind / incident kind) are copies of src/locales — src/lib/pushText.test.ts checks they still match.
export const PUSH_LOCALES = ['ja', 'en', 'vi', 'ne', 'si', 'my'] as const
export type PushLocale = (typeof PUSH_LOCALES)[number]

export const PUSH_LABELS: Record<PushLocale, { shift: Record<string, string>; change: Record<string, string>; incident: Record<string, string>; state: Record<string, string> }> = {
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
    },
    "state": {
      "reported": "報告済み",
      "checking": "確認中",
      "in_progress": "対応中",
      "on_hold": "保留・外部待ち",
      "repaired": "修理完了・確認待ち",
      "done": "完了",
      "reopened": "再対応",
      "cancelled": "取消",
      "received": "受付",
      "content_check": "内容確認",
      "answered": "回答",
      "resolution_check": "解決確認",
      "occurred": "発生",
      "safety": "安全確保",
      "reported_mgr": "管理者報告",
      "investigating": "原因調査",
      "prevention": "再発防止",
      "found": "発見",
      "isolated": "隔離・提供停止",
      "corrected": "是正",
      "safety_check": "安全確認",
      "txn_check": "取引確認",
      "decision": "対応判断",
      "refund_fix": "返金・修正",
      "reconcile": "照合",
      "classified": "分類",
      "check": "確認"
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
    },
    "state": {
      "reported": "Reported",
      "checking": "Checking",
      "in_progress": "In progress",
      "on_hold": "On hold / waiting",
      "repaired": "Repaired, to confirm",
      "done": "Done",
      "reopened": "Rework",
      "cancelled": "Cancelled",
      "received": "Received",
      "content_check": "Checking the content",
      "answered": "Answered",
      "resolution_check": "Checking the resolution",
      "occurred": "Occurred",
      "safety": "Safety secured",
      "reported_mgr": "Reported to a manager",
      "investigating": "Investigating the cause",
      "prevention": "Prevention",
      "found": "Found",
      "isolated": "Isolated / service stopped",
      "corrected": "Corrected",
      "safety_check": "Safety confirmed",
      "txn_check": "Checking the transaction",
      "decision": "Deciding",
      "refund_fix": "Refund / correction",
      "reconcile": "Reconciling",
      "classified": "Classified",
      "check": "Checking"
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
    },
    "state": {
      "reported": "Đã báo",
      "checking": "Đang xác nhận",
      "in_progress": "Đang xử lý",
      "on_hold": "Tạm dừng / chờ bên ngoài",
      "repaired": "Đã sửa, chờ xác nhận",
      "done": "Hoàn tất",
      "reopened": "Xử lý lại",
      "cancelled": "Đã huỷ",
      "received": "Tiếp nhận",
      "content_check": "Xác nhận nội dung",
      "answered": "Đã trả lời",
      "resolution_check": "Xác nhận giải quyết",
      "occurred": "Xảy ra",
      "safety": "Đảm bảo an toàn",
      "reported_mgr": "Đã báo quản lý",
      "investigating": "Điều tra nguyên nhân",
      "prevention": "Phòng tái phát",
      "found": "Phát hiện",
      "isolated": "Cách ly / ngừng phục vụ",
      "corrected": "Khắc phục",
      "safety_check": "Xác nhận an toàn",
      "txn_check": "Xác nhận giao dịch",
      "decision": "Quyết định xử lý",
      "refund_fix": "Hoàn tiền / sửa",
      "reconcile": "Đối chiếu",
      "classified": "Phân loại",
      "check": "Kiểm tra"
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
    },
    "state": {
      "reported": "रिपोर्ट गरियो",
      "checking": "जाँच हुँदै",
      "in_progress": "काम हुँदै",
      "on_hold": "रोकिएको / बाहिरी प्रतीक्षा",
      "repaired": "मर्मत भयो, पुष्टि बाँकी",
      "done": "सम्पन्न",
      "reopened": "फेरि काम",
      "cancelled": "रद्द",
      "received": "प्राप्त",
      "content_check": "विवरण जाँच",
      "answered": "जवाफ दिइयो",
      "resolution_check": "समाधान जाँच",
      "occurred": "घटना भयो",
      "safety": "सुरक्षा सुनिश्चित",
      "reported_mgr": "व्यवस्थापकलाई जानकारी",
      "investigating": "कारण अनुसन्धान",
      "prevention": "पुनरावृत्ति रोकथाम",
      "found": "भेटियो",
      "isolated": "छुट्याइयो / सेवा रोकियो",
      "corrected": "सुधार",
      "safety_check": "सुरक्षा पुष्टि",
      "txn_check": "कारोबार जाँच",
      "decision": "निर्णय",
      "refund_fix": "फिर्ता / सुधार",
      "reconcile": "मिलान",
      "classified": "वर्गीकरण",
      "check": "जाँच"
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
    },
    "state": {
      "reported": "වාර්තා කළා",
      "checking": "පරීක්ෂා කරමින්",
      "in_progress": "කටයුතු කරමින්",
      "on_hold": "නවතා ඇත / බාහිර බලාපොරොත්තුවෙන්",
      "repaired": "අලුත්වැඩියා කළා, තහවුරු කිරීමට",
      "done": "අවසන්",
      "reopened": "නැවත කටයුතු",
      "cancelled": "අවලංගු",
      "received": "ලැබුණා",
      "content_check": "අන්තර්ගතය පරීක්ෂාව",
      "answered": "පිළිතුරු දුන්නා",
      "resolution_check": "විසඳුම පරීක්ෂාව",
      "occurred": "සිදු වුණා",
      "safety": "ආරක්ෂාව තහවුරු කළා",
      "reported_mgr": "කළමනාකරුට දැන්වූවා",
      "investigating": "හේතුව සොයමින්",
      "prevention": "නැවත නොවීමට",
      "found": "සොයාගත්තා",
      "isolated": "වෙන් කළා / සේවය නැවැත්වූවා",
      "corrected": "නිවැරදි කළා",
      "safety_check": "ආරක්ෂාව තහවුරු කළා",
      "txn_check": "ගනුදෙනුව පරීක්ෂාව",
      "decision": "තීරණය",
      "refund_fix": "මුදල් ආපසු / නිවැරදි",
      "reconcile": "සසඳමින්",
      "classified": "වර්ග කළා",
      "check": "පරීක්ෂාව"
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
    },
    "state": {
      "reported": "အစီရင်ခံပြီး",
      "checking": "စစ်ဆေးနေသည်",
      "in_progress": "ကိုင်တွယ်နေသည်",
      "on_hold": "ဆိုင်းငံ့ / စောင့်နေ",
      "repaired": "ပြင်ပြီး၊ အတည်ပြုရန်",
      "done": "ပြီးဆုံး",
      "reopened": "ပြန်လုပ်ရန်",
      "cancelled": "ပယ်ဖျက်ပြီး",
      "received": "လက်ခံပြီး",
      "content_check": "အကြောင်းအရာ စစ်ဆေးနေ",
      "answered": "ဖြေကြားပြီး",
      "resolution_check": "ဖြေရှင်းမှု စစ်ဆေးနေ",
      "occurred": "ဖြစ်ပွား",
      "safety": "ဘေးကင်းအောင် လုပ်ပြီး",
      "reported_mgr": "မန်နေဂျာထံ အစီရင်ခံပြီး",
      "investigating": "အကြောင်းရင်း စုံစမ်းနေ",
      "prevention": "ထပ်မဖြစ်စေရန် ကာကွယ်ခြင်း",
      "found": "တွေ့ရှိ",
      "isolated": "ခွဲထား / ပေးခြင်း ရပ်ထား",
      "corrected": "ပြုပြင်ပြီး",
      "safety_check": "ဘေးကင်းကြောင်း အတည်ပြုပြီး",
      "txn_check": "ငွေပေးချေမှု စစ်ဆေးနေ",
      "decision": "ဆုံးဖြတ်နေ",
      "refund_fix": "ငွေပြန်အမ်း / ပြင်ဆင်",
      "reconcile": "တိုက်စစ်နေ",
      "classified": "အမျိုးအစား ခွဲပြီး",
      "check": "စစ်ဆေးနေ"
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
      "{date} {shift} {time}。アプリで「引き受ける」か「断る」を押してください。"
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
    ],
    "consent_ok": [
      "✅ {cover}さんが代わりを引き受けました",
      "{date} {shift}。管理者の承認を待っています。"
    ],
    "consent_ng": [
      "❌ {cover}さんは代われません",
      "{date} {shift}。{note}"
    ],
    "mgr_report_named": [
      "🙋 {name}：{kind}",
      "{date} {shift} {time}。指名された{named}さんの返事を待っています。"
    ],
    "mgr_accepted": [
      "🤝 {offer}さんが代わりを引き受けました",
      "{name}さんの {date} {shift}。承認してください。"
    ],
    "mgr_declined": [
      "❌ {offer}さんは代われません",
      "{name}さんの {date} {shift}。{note}"
    ],
    "schedule": [
      "📅 シフトが変わりました（{n}件）",
      "{items}"
    ],
    "comment": [
      "💬 {author}さんからコメント（{what} {date}）",
      "{body}"
    ],
    "shift_request": [
      "📝 {month}月のシフト希望を出してください",
      "締め切りは {deadline} です。"
    ],
    "shift_request_last": [
      "📝 今日がシフト希望の締め切りです",
      "{month}月のシフト希望をまだ出していません。今日中に出してください。"
    ],
    "inc_state": [
      "⚠️ {kind}：{state}",
      "{actor}さんが「{state}」に進めました。{body}"
    ],
    "inc_assign_you": [
      "👤 あなたが担当になりました",
      "{kind}（No.{no}）"
    ],
    "inc_assign": [
      "👤 担当者が決まりました",
      "{kind}（No.{no}）：{assignee}さん"
    ],
    "inc_comment": [
      "💬 {kind}：{actor}さんからコメント",
      "{body}"
    ],
    "lost_step": [
      "👜 忘れ物：{lost}",
      "{desc}。{actor}：{body}"
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
      "{date} {shift} {time}. Tap \"Accept\" or \"Decline\" in the app."
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
    ],
    "consent_ok": [
      "✅ {cover} accepted to cover",
      "{date} {shift}. Waiting for a manager to approve."
    ],
    "consent_ng": [
      "❌ {cover} cannot cover",
      "{date} {shift}. {note}"
    ],
    "mgr_report_named": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}. Waiting for {named} (named) to answer."
    ],
    "mgr_accepted": [
      "🤝 {offer} accepted to cover",
      "{name}'s {date} {shift}. Please approve."
    ],
    "mgr_declined": [
      "❌ {offer} cannot cover",
      "{name}'s {date} {shift}. {note}"
    ],
    "schedule": [
      "📅 Your shifts changed ({n})",
      "{items}"
    ],
    "comment": [
      "💬 Comment from {author} ({what} {date})",
      "{body}"
    ],
    "shift_request": [
      "📝 Please send your shift wishes for month {month}",
      "The deadline is {deadline}."
    ],
    "shift_request_last": [
      "📝 Today is the deadline for shift wishes",
      "You have not sent your wishes for month {month}. Please send them today."
    ],
    "inc_state": [
      "⚠️ {kind}: {state}",
      "{actor} moved it to \"{state}\". {body}"
    ],
    "inc_assign_you": [
      "👤 You are in charge",
      "{kind} (No.{no})"
    ],
    "inc_assign": [
      "👤 A person in charge was chosen",
      "{kind} (No.{no}): {assignee}"
    ],
    "inc_comment": [
      "💬 {kind}: comment from {actor}",
      "{body}"
    ],
    "lost_step": [
      "👜 Lost item: {lost}",
      "{desc}. {actor}: {body}"
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
      "{date} {shift} {time}. Hãy bấm \"Nhận làm thay\" hoặc \"Từ chối\" trong app."
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
    ],
    "consent_ok": [
      "✅ {cover} đã nhận làm thay",
      "{date} {shift}. Đang chờ quản lý duyệt."
    ],
    "consent_ng": [
      "❌ {cover} không làm thay được",
      "{date} {shift}. {note}"
    ],
    "mgr_report_named": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}. Đang chờ {named} (người được chọn) trả lời."
    ],
    "mgr_accepted": [
      "🤝 {offer} đã nhận làm thay",
      "Ca {date} {shift} của {name}. Vui lòng duyệt."
    ],
    "mgr_declined": [
      "❌ {offer} không làm thay được",
      "Ca {date} {shift} của {name}. {note}"
    ],
    "schedule": [
      "📅 Lịch ca của bạn đã thay đổi ({n})",
      "{items}"
    ],
    "comment": [
      "💬 {author} đã bình luận ({what} {date})",
      "{body}"
    ],
    "shift_request": [
      "📝 Hãy nộp nguyện vọng ca tháng {month}",
      "Hạn chót là {deadline}."
    ],
    "shift_request_last": [
      "📝 Hôm nay là hạn nộp nguyện vọng ca",
      "Bạn chưa nộp nguyện vọng ca tháng {month}. Hãy nộp trong hôm nay."
    ],
    "inc_state": [
      "⚠️ {kind}: {state}",
      "{actor} đã chuyển sang \"{state}\". {body}"
    ],
    "inc_assign_you": [
      "👤 Bạn được giao phụ trách",
      "{kind} (No.{no})"
    ],
    "inc_assign": [
      "👤 Đã có người phụ trách",
      "{kind} (No.{no}): {assignee}"
    ],
    "inc_comment": [
      "💬 {kind}: bình luận của {actor}",
      "{body}"
    ],
    "lost_step": [
      "👜 Đồ thất lạc: {lost}",
      "{desc}. {actor}: {body}"
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
      "{date} {shift} {time}। एपमा \"स्वीकार\" वा \"अस्वीकार\" थिच्नुहोस्।"
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
    ],
    "consent_ok": [
      "✅ {cover} ले सट्टा काम गर्न स्वीकार गर्नुभयो",
      "{date} {shift}। म्यानेजरको स्वीकृति पर्खँदै।"
    ],
    "consent_ng": [
      "❌ {cover} सट्टा काम गर्न सक्नुहुन्न",
      "{date} {shift}। {note}"
    ],
    "mgr_report_named": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}। छानिएका {named} को जवाफ पर्खँदै।"
    ],
    "mgr_accepted": [
      "🤝 {offer} ले सट्टा काम गर्न स्वीकार गर्नुभयो",
      "{name} को {date} {shift}। कृपया स्वीकृत गर्नुहोस्।"
    ],
    "mgr_declined": [
      "❌ {offer} सट्टा काम गर्न सक्नुहुन्न",
      "{name} को {date} {shift}। {note}"
    ],
    "schedule": [
      "📅 तपाईंको सिफ्ट परिवर्तन भयो ({n})",
      "{items}"
    ],
    "comment": [
      "💬 {author} को टिप्पणी ({what} {date})",
      "{body}"
    ],
    "shift_request": [
      "📝 {month} महिनाको सिफ्ट इच्छा पठाउनुहोस्",
      "अन्तिम मिति {deadline} हो।"
    ],
    "shift_request_last": [
      "📝 आज सिफ्ट इच्छा पठाउने अन्तिम दिन हो",
      "{month} महिनाको सिफ्ट इच्छा अझै पठाउनुभएको छैन। आजै पठाउनुहोस्।"
    ],
    "inc_state": [
      "⚠️ {kind}: {state}",
      "{actor} ले \"{state}\" मा सार्नुभयो। {body}"
    ],
    "inc_assign_you": [
      "👤 तपाईं जिम्मेवार हुनुभयो",
      "{kind} (No.{no})"
    ],
    "inc_assign": [
      "👤 जिम्मेवार व्यक्ति तय भयो",
      "{kind} (No.{no}): {assignee}"
    ],
    "inc_comment": [
      "💬 {kind}: {actor} को टिप्पणी",
      "{body}"
    ],
    "lost_step": [
      "👜 हराएको सामान: {lost}",
      "{desc}। {actor}: {body}"
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
      "{date} {shift} {time}. ඇප් එකේ \"පිළිගන්න\" හෝ \"ප්‍රතික්ෂේප කරන්න\" ඔබන්න."
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
    ],
    "consent_ok": [
      "✅ {cover} වෙනුවට වැඩ කිරීමට එකඟ වුණා",
      "{date} {shift}. කළමනාකරුගේ අනුමැතිය බලාපොරොත්තුවෙන්."
    ],
    "consent_ng": [
      "❌ {cover}ට වෙනුවට වැඩ කළ නොහැක",
      "{date} {shift}. {note}"
    ],
    "mgr_report_named": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}. තෝරාගත් {named}ගේ පිළිතුර බලාපොරොත්තුවෙන්."
    ],
    "mgr_accepted": [
      "🤝 {offer} වෙනුවට වැඩ කිරීමට එකඟ වුණා",
      "{name}ගේ {date} {shift}. කරුණාකර අනුමත කරන්න."
    ],
    "mgr_declined": [
      "❌ {offer}ට වෙනුවට වැඩ කළ නොහැක",
      "{name}ගේ {date} {shift}. {note}"
    ],
    "schedule": [
      "📅 ඔබේ ෂිෆ්ට් වෙනස් වුණා ({n})",
      "{items}"
    ],
    "comment": [
      "💬 {author}ගෙන් සටහනක් ({what} {date})",
      "{body}"
    ],
    "shift_request": [
      "📝 {month} මාසයේ ෂිෆ්ට් කැමැත්ත යවන්න",
      "අවසාන දිනය {deadline}."
    ],
    "shift_request_last": [
      "📝 අද ෂිෆ්ට් කැමැත්ත යැවීමේ අවසාන දිනයයි",
      "{month} මාසයේ ෂිෆ්ට් කැමැත්ත තවම යවා නැත. අදම යවන්න."
    ],
    "inc_state": [
      "⚠️ {kind}: {state}",
      "{actor} \"{state}\" වෙත ගෙන ගියා. {body}"
    ],
    "inc_assign_you": [
      "👤 ඔබ භාරකරු වුණා",
      "{kind} (No.{no})"
    ],
    "inc_assign": [
      "👤 භාරකරු තීරණය වුණා",
      "{kind} (No.{no}): {assignee}"
    ],
    "inc_comment": [
      "💬 {kind}: {actor}ගෙන් සටහනක්",
      "{body}"
    ],
    "lost_step": [
      "👜 නැතිවූ භාණ්ඩ: {lost}",
      "{desc}. {actor}: {body}"
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
      "{date} {shift} {time}။ အက်ပ်တွင် \"လက်ခံမည်\" သို့မဟုတ် \"ငြင်းမည်\" ကို နှိပ်ပါ။"
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
    ],
    "consent_ok": [
      "✅ {cover} က အစားဝင်ရန် လက်ခံပါပြီ",
      "{date} {shift}။ မန်နေဂျာ၏ ခွင့်ပြုချက်ကို စောင့်နေပါသည်။"
    ],
    "consent_ng": [
      "❌ {cover} အစားမဝင်နိုင်ပါ",
      "{date} {shift}။ {note}"
    ],
    "mgr_report_named": [
      "🙋 {name}: {kind}",
      "{date} {shift} {time}။ ရွေးထားသော {named} ၏ အဖြေကို စောင့်နေပါသည်။"
    ],
    "mgr_accepted": [
      "🤝 {offer} က အစားဝင်ရန် လက်ခံပါပြီ",
      "{name} ၏ {date} {shift}။ ခွင့်ပြုပေးပါ။"
    ],
    "mgr_declined": [
      "❌ {offer} အစားမဝင်နိုင်ပါ",
      "{name} ၏ {date} {shift}။ {note}"
    ],
    "schedule": [
      "📅 သင့်ဆိုင်း ပြောင်းလဲသွားပါသည် ({n})",
      "{items}"
    ],
    "comment": [
      "💬 {author} ၏ မှတ်ချက် ({what} {date})",
      "{body}"
    ],
    "shift_request": [
      "📝 {month} လအတွက် ဆိုင်းဆန္ဒ ပို့ပါ",
      "နောက်ဆုံးရက်မှာ {deadline} ဖြစ်ပါသည်။"
    ],
    "shift_request_last": [
      "📝 ယနေ့ ဆိုင်းဆန္ဒ ပို့ရမည့် နောက်ဆုံးရက်ဖြစ်ပါသည်",
      "{month} လအတွက် ဆိုင်းဆန္ဒ မပို့ရသေးပါ။ ယနေ့ ပို့ပါ။"
    ],
    "inc_state": [
      "⚠️ {kind}: {state}",
      "{actor} က \"{state}\" သို့ ရွှေ့ပါသည်။ {body}"
    ],
    "inc_assign_you": [
      "👤 သင် တာဝန်ခံ ဖြစ်ပါပြီ",
      "{kind} (No.{no})"
    ],
    "inc_assign": [
      "👤 တာဝန်ခံ သတ်မှတ်ပြီးပါပြီ",
      "{kind} (No.{no}): {assignee}"
    ],
    "inc_comment": [
      "💬 {kind}: {actor} ၏ မှတ်ချက်",
      "{body}"
    ],
    "lost_step": [
      "👜 ပျောက်ပစ္စည်း: {lost}",
      "{desc}။ {actor}: {body}"
    ]
  }
}

export const PUSH_WORDS: Record<PushLocale, { chorei: string; patrol: string; added: string; removed: string; changed: string; more: string; lost: Record<string, string> }> = {
  "ja": {
    "chorei": "朝礼",
    "patrol": "巡回",
    "added": "追加",
    "removed": "なくなりました",
    "changed": "変更",
    "more": "ほか{n}件",
    "lost": {
      "await": "返却待ちになりました",
      "returned": "返却を記録しました",
      "police": "警察に届けました",
      "approve": "管理者が確認しました",
      "reject": "差し戻されました",
      "dispose": "処分しました",
      "comment": "コメントがあります"
    }
  },
  "en": {
    "chorei": "Meeting",
    "patrol": "Patrol",
    "added": "added",
    "removed": "removed",
    "changed": "changed",
    "more": "+{n} more",
    "lost": {
      "await": "waiting for the owner",
      "returned": "return recorded",
      "police": "taken to the police",
      "approve": "checked by a manager",
      "reject": "sent back",
      "dispose": "disposed",
      "comment": "new comment"
    }
  },
  "vi": {
    "chorei": "Họp ca",
    "patrol": "Tuần tra",
    "added": "thêm",
    "removed": "bỏ",
    "changed": "đổi",
    "more": "và {n} mục khác",
    "lost": {
      "await": "đang chờ trả lại",
      "returned": "đã ghi nhận trả lại",
      "police": "đã nộp cảnh sát",
      "approve": "quản lý đã xác nhận",
      "reject": "bị trả lại để sửa",
      "dispose": "đã xử lý bỏ",
      "comment": "có bình luận"
    }
  },
  "ne": {
    "chorei": "बैठक",
    "patrol": "निरीक्षण",
    "added": "थपियो",
    "removed": "हटाइयो",
    "changed": "परिवर्तन",
    "more": "अरू {n}",
    "lost": {
      "await": "मालिकलाई पर्खँदै",
      "returned": "फिर्ता दर्ता भयो",
      "police": "प्रहरीलाई बुझाइयो",
      "approve": "म्यानेजरले जाँच्नुभयो",
      "reject": "सच्याउन फिर्ता पठाइयो",
      "dispose": "फालियो",
      "comment": "नयाँ टिप्पणी"
    }
  },
  "si": {
    "chorei": "රැස්වීම",
    "patrol": "පරීක්ෂාව",
    "added": "එක් කළා",
    "removed": "ඉවත් කළා",
    "changed": "වෙනස් කළා",
    "more": "තවත් {n}",
    "lost": {
      "await": "හිමිකරු බලාපොරොත්තුවෙන්",
      "returned": "ආපසු දීම සටහන් කළා",
      "police": "පොලිසියට භාර දුන්නා",
      "approve": "කළමනාකරු පරීක්ෂා කළා",
      "reject": "නිවැරදි කිරීමට ආපසු එව්වා",
      "dispose": "ඉවත දැමුවා",
      "comment": "නව සටහනක්"
    }
  },
  "my": {
    "chorei": "အစည်းအဝေး",
    "patrol": "စစ်ဆေးမှု",
    "added": "ထည့်သည်",
    "removed": "ဖယ်သည်",
    "changed": "ပြောင်းသည်",
    "more": "နောက်ထပ် {n}",
    "lost": {
      "await": "ပိုင်ရှင်ကို စောင့်နေသည်",
      "returned": "ပြန်ပေးကြောင်း မှတ်တမ်းတင်ပြီး",
      "police": "ရဲထံ အပ်ပြီး",
      "approve": "မန်နေဂျာ စစ်ဆေးပြီး",
      "reject": "ပြင်ရန် ပြန်ပို့သည်",
      "dispose": "စွန့်ပစ်ပြီး",
      "comment": "မှတ်ချက်အသစ်"
    }
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
  const W = PUSH_WORDS[loc]
  const str = (k: string) => (data[k] == null ? '' : String(data[k]))
  const day = (iso: unknown) => {
    if (typeof iso !== 'string') return ''
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${t.dow![d.getUTCDay()]})`
  }
  const items = Array.isArray(data.items) ? (data.items as Record<string, string>[]) : []
  const listed = items
    .slice(0, 3)
    .map((i) => [day(i.date), L.shift[i.shift ?? ''] ?? i.shift, W[i.kind as 'added'] ?? i.kind, i.detail].filter(Boolean).join(' '))
    .join(' / ')
  const more = Number(data.n ?? items.length) - Math.min(items.length, 3)
  const v: Record<string, string> = {
    date: day(data.date),
    shift: L.shift[str('shift')] ?? str('shift'),
    time: typeof data.from === 'number' && typeof data.to === 'number' ? `${hm(data.from)}–${hm(data.to)}` : '',
    store: str('store'),
    name: str('name'),
    named: str('named'),
    cover: str('cover'),
    note: str('note'),
    offer: str('offer_name'),
    n: str('n'),
    h: str('hours'),
    month: str('month'),
    deadline: str('deadline'),
    author: str('author'),
    body: str('body'),
    actor: str('actor'),
    assignee: str('assignee'),
    desc: str('desc'),
    no: String(data.no ?? '').padStart(4, '0'),
    what: W[str('what') as 'chorei'] ?? '',
    state: L.state[str('to')] ?? str('to'),
    lost: W.lost[str('action') || 'comment'] ?? W.lost.comment!,
    items: listed + (more > 0 ? ` / ${W.more.replace('{n}', String(more))}` : ''),
    kind: kind === 'mgr_incident' || kind === 'inc_step' ? (L.incident[str('kind')] ?? str('kind')) : (L.change[str('kind')] ?? str('kind')),
  }
  const key =
    kind === 'decided' ? (data.ok ? 'decided_ok' : 'decided_ng')
    : kind === 'consent' ? (data.ok ? 'consent_ok' : 'consent_ng')
    : kind === 'mgr_change'
      ? data.event === 'offer' ? 'mgr_offer'
        : data.event === 'reminder' ? 'mgr_reminder'
        : data.event === 'accepted' ? 'mgr_accepted'
        : data.event === 'declined' ? 'mgr_declined'
        : data.consent === 'pending' ? 'mgr_report_named'
        : 'mgr_report'
    : kind === 'mgr_incident' ? (data.event === 'overdue' ? 'mgr_overdue' : 'mgr_created')
    : kind === 'shift_request' ? (data.last ? 'shift_request_last' : 'shift_request')
    : kind === 'inc_step' ? (data.event === 'assign' ? (data.you ? 'inc_assign_you' : 'inc_assign') : data.event === 'comment' ? 'inc_comment' : 'inc_state')
    : kind
  const [title, body] = t[key] ?? t.test!
  const tidy = (x: string) => x.replace(/\s+([。.,、।])/g, '$1').replace(/\s+/g, ' ').trim().replace(/\s*[:：]$/, '')
  return { title: tidy(fill(title!, v)), body: tidy(fill(body!, v)) }
}
