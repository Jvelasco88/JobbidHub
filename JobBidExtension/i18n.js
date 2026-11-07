// Interface language (English / 한국어 / 中文).
// The UI is written in English; this translates JobBid's own text in place - text nodes plus
// title / placeholder / aria-label - and keeps doing so as pages re-render (MutationObserver).
// In content scripts it only ever touches JobBid's shadow roots, never the job site's page.
// Option *values* stay English, so saved answers and form filling are unaffected.

(() => {
  if (self.jbI18n) return;

  const LANGS = { en: 'English', ko: '한국어', zh: '中文' };
  const SHORT = { en: 'EN', ko: '한', zh: '中' };

  // 'English': ['한국어', '中文']
  const T = {
    // Common
    'JobBid': ['JobBid', 'JobBid'],
    'Home': ['홈', '首页'],
    'Profiles': ['프로필', '个人资料'],
    'Profile': ['프로필', '个人资料'],
    'Applications': ['지원 내역', '申请记录'],
    'Schedule': ['일정', '日程'],
    'Daily log': ['일일 기록', '每日记录'],
    'AI keys': ['AI 키', 'AI 密钥'],
    'Settings': ['설정', '设置'],
    'Dashboard': ['대시보드', '控制台'],
    'Dark mode': ['다크 모드', '深色模式'],
    'Light mode': ['라이트 모드', '浅色模式'],
    'Switch to light mode': ['라이트 모드로 전환', '切换到浅色模式'],
    'Switch to dark mode': ['다크 모드로 전환', '切换到深色模式'],
    'Switch light / dark': ['라이트 / 다크 전환', '切换浅色 / 深色'],
    'Open dashboard': ['대시보드 열기', '打开控制台'],
    'Smart job applications': ['스마트 입사 지원', '智能求职申请'],
    'Main': ['메인', '主菜单'],
    'Language': ['언어', '语言'],
    'Interface language for the dashboard, popup, side panel and notifications': ['대시보드, 팝업, 사이드 패널, 알림에 쓰이는 언어', '控制台、弹窗、侧边栏和通知使用的语言'],
    'Switch': ['전환', '切换'],
    'Switch profile': ['프로필 전환', '切换资料'],
    'Applying as': ['지원자', '申请人'],
    'Active profile': ['사용 중인 프로필', '当前资料'],
    'Active': ['사용 중', '使用中'],
    'Open': ['열기', '打开'],
    'Close': ['닫기', '关闭'],
    'Copy': ['복사', '复制'],
    'Save': ['저장', '保存'],
    'Cancel': ['취소', '取消'],
    'Delete': ['삭제', '删除'],
    'Export': ['내보내기', '导出'],
    'Restore': ['복원', '恢复'],
    'Clear': ['지우기', '清除'],
    'Check': ['확인', '检查'],
    'Default': ['기본', '默认'],
    'Set default': ['기본으로 설정', '设为默认'],
    'Options': ['옵션', '选项'],
    'Notes': ['메모', '备注'],
    'Today': ['오늘', '今天'],
    'Total': ['전체', '总计'],
    '7 days': ['7일', '7 天'],
    'Last 7 days': ['최근 7일', '最近 7 天'],
    'This week': ['이번 주', '本周'],
    'Last 30 days': ['최근 30일', '最近 30 天'],
    'Good morning': ['좋은 아침입니다', '早上好'],
    'Good afternoon': ['안녕하세요', '下午好'],
    'Good evening': ['좋은 저녁입니다', '晚上好'],
    'just now': ['방금', '刚刚'],
    'Sun': ['일', '周日'], 'Mon': ['월', '周一'], 'Tue': ['화', '周二'], 'Wed': ['수', '周三'],
    'Thu': ['목', '周四'], 'Fri': ['금', '周五'], 'Sat': ['토', '周六'],

    // Popup
    'AI not connected': ['AI 연결 안 됨', 'AI 未连接'],
    'AI key saved': ['AI 키 저장됨', 'AI 密钥已保存'],
    'Welcome to JobBid': ['JobBid에 오신 것을 환영합니다', '欢迎使用 JobBid'],
    'Import a resume to create your first profile. It takes about a minute.': ['이력서를 가져와 첫 프로필을 만드세요. 1분 정도 걸립니다.', '导入简历即可创建第一个资料，大约需要一分钟。'],
    'Import a resume': ['이력서 가져오기', '导入简历'],
    'Checking this page...': ['페이지 확인 중...', '正在检查此页面...'],
    'Fill application': ['지원서 자동 입력', '自动填写申请'],
    'Fill again': ['다시 입력', '再次填写'],
    'Try to fill anyway': ['그래도 입력해 보기', '仍然尝试填写'],
    'Open a job page to fill': ['채용 페이지를 열어 주세요', '请打开职位页面'],
    'Log applied': ['지원 기록', '记录申请'],
    'Cover letter': ['자기소개서', '求职信'],
    'Save this job to the tracker': ['이 공고를 지원 내역에 저장', '将此职位保存到记录'],
    'Job title': ['직무명', '职位名称'],
    'Company': ['회사', '公司'],
    'Save to tracker': ['지원 내역에 저장', '保存到记录'],
    'AI cover letter for this job': ['이 공고용 AI 자기소개서', '为此职位生成 AI 求职信'],
    'Generate': ['생성', '生成'],
    'Copy to clipboard': ['클립보드에 복사', '复制到剪贴板'],
    'to fill': ['자동 입력', '填写'],
    'Multi-step form? Fill each step': ['여러 단계 양식은 단계마다 입력하세요', '多步表单？请逐步填写'],
    'Resume to attach': ['첨부할 이력서', '要附加的简历'],
    'Attach: best resume for this site (auto)': ['첨부: 이 사이트에 맞는 이력서 (자동)', '附加：最适合此网站的简历（自动）'],
    'No resume file on this profile': ['이 프로필에 이력서 파일이 없습니다', '此资料没有简历文件'],
    'No headline': ['헤드라인 없음', '无标题'],
    'Not a web page': ['웹 페이지가 아닙니다', '不是网页'],
    'Open a job application to use autofill.': ['자동 입력을 쓰려면 지원서 페이지를 여세요.', '请打开职位申请页面以使用自动填写。'],
    'Reload the tab and try again.': ['탭을 새로고침한 뒤 다시 시도하세요.', '请刷新标签页后重试。'],
    'Already applied here': ['이미 지원한 곳입니다', '已在此申请过'],
    'Application form detected': ['지원서 양식 감지됨', '检测到申请表'],
    'No application form yet': ['아직 지원서 양식이 없습니다', '尚未发现申请表'],
    'Could not reach this page. Reload the tab and try again.': ['페이지에 연결할 수 없습니다. 탭을 새로고침한 뒤 다시 시도하세요.', '无法访问此页面，请刷新标签页后重试。'],
    'Saved to tracker.': ['지원 내역에 저장했습니다.', '已保存到记录。'],
    'Writing cover letter...': ['자기소개서 작성 중...', '正在撰写求职信...'],
    'Copied.': ['복사했습니다.', '已复制。'],

    // Dashboard - home
    'Get set up': ['시작하기', '开始设置'],
    'Total applications': ['총 지원 수', '申请总数'],
    'Interviews & offers': ['면접 및 합격', '面试和录用'],
    'Applications per day': ['일별 지원 수', '每日申请数'],
    'Last 14 days · all profiles': ['최근 14일 · 전체 프로필', '最近 14 天 · 全部资料'],
    'Recent': ['최근', '最近'],
    'View all': ['모두 보기', '查看全部'],
    'Add a free AI key (Groq or OpenRouter)': ['무료 AI 키 추가 (Groq 또는 OpenRouter)', '添加免费 AI 密钥（Groq 或 OpenRouter）'],
    'Import a resume to create a profile': ['이력서를 가져와 프로필 만들기', '导入简历以创建资料'],
    'Attach a resume file to a profile': ['프로필에 이력서 파일 첨부', '为资料附加简历文件'],
    'Fill an application and log it to the tracker': ['지원서를 입력하고 지원 내역에 기록하기', '填写一份申请并记录'],
    'Untitled job': ['제목 없는 공고', '未命名职位'],
    'No applications yet. Open a job, click': ['아직 지원 내역이 없습니다. 공고를 열고', '暂无申请。打开一个职位，点击'],
    ', submit, then log it.': [' 을(를) 누른 뒤 제출하고 기록하세요.', '，提交后再记录。'],
    'Fill': ['자동 입력', '填写'],

    // Profiles
    'One profile per person. Each can hold several resume versions.': ['한 사람당 프로필 하나. 프로필마다 여러 버전의 이력서를 둘 수 있습니다.', '每人一个资料，每个资料可保存多个简历版本。'],
    'Import resumes': ['이력서 가져오기', '导入简历'],
    "Drop PDF / DOCX here or click to browse. Same person? It's added as another version automatically.": ['PDF / DOCX 파일을 끌어다 놓거나 클릭해서 선택하세요. 같은 사람이면 자동으로 다른 버전으로 추가됩니다.', '将 PDF / DOCX 拖到此处或点击浏览。同一个人会自动添加为另一个版本。'],
    'Blank profile': ['빈 프로필', '空白资料'],
    'New profile': ['새 프로필', '新资料'],
    'No profiles yet': ['아직 프로필이 없습니다', '暂无资料'],
    'Drop resumes into the import box to create one per person.': ['가져오기 상자에 이력서를 놓으면 사람마다 프로필이 만들어집니다.', '将简历拖入导入框，即可为每人创建资料。'],
    'Use this profile': ['이 프로필 사용', '使用此资料'],
    'All changes saved': ['모든 변경 사항 저장됨', '所有更改已保存'],
    'Resume files': ['이력서 파일', '简历文件'],
    'No resume files yet.': ['아직 이력서 파일이 없습니다.', '暂无简历文件。'],
    'Drop another version here or click to add': ['다른 버전을 여기에 놓거나 클릭해서 추가', '将其他版本拖到此处或点击添加'],
    'Summary & skills': ['요약 및 기술', '简介和技能'],
    'Professional summary': ['경력 요약', '职业简介'],
    'Skills (press Enter to add)': ['기술 (Enter로 추가)', '技能（按 Enter 添加）'],
    'Experience': ['경력', '工作经历'],
    'Education': ['학력', '教育背景'],
    'Current': ['재직 중', '在职'],
    'Present': ['현재', '至今'],
    'New entry': ['새 항목', '新条目'],
    'Add answer': ['답변 추가', '添加回答'],
    'Saved answers': ['저장된 답변', '已保存的回答'],
    'Choose answer...': ['답변 선택...', '选择回答...'],
    "JobBid saw these on applications but couldn't answer them. Answer once here and they're filled automatically next time.": ['지원서에서 JobBid가 답하지 못한 질문입니다. 여기서 한 번 답하면 다음부터 자동으로 입력됩니다.', 'JobBid 在申请中遇到但无法回答的问题。在此回答一次，下次将自动填写。'],
    "None yet. Questions JobBid can't answer on a form are collected here automatically, and anything you or the AI answer is remembered.": ['아직 없습니다. JobBid가 답하지 못한 질문은 여기에 자동으로 모이며, 직접 또는 AI가 답한 내용은 기억됩니다.', '暂无。JobBid 无法回答的问题会自动收集到这里，你或 AI 的回答都会被记住。'],
    'Fill typical answers': ['일반적인 답변 채우기', '填入常见回答'],
    "Fills only empty ones: 18+ Yes, essential functions Yes, background/drug check Yes, contact employers Yes, fired No, convicted No, non-compete No, relatives No, worked here before No. Change any that aren't true.": ['빈 항목만 채웁니다: 18세 이상 예, 필수 직무 수행 예, 신원/약물 검사 예, 고용주 연락 예, 해고 아니오, 유죄 판결 아니오, 경업금지 아니오, 친인척 아니오, 이전 근무 아니오. 사실과 다른 항목은 바꾸세요.', '只填写空白项：年满 18 岁 是，能履行基本职责 是，背景/药检 是，可联系雇主 是，被解雇 否，犯罪记录 否，竞业限制 否，亲属在职 否，曾在此工作 否。如有不符请修改。'],
    'Personal & contact': ['개인 정보 및 연락처', '个人和联系方式'],
    'Profile label': ['프로필 이름', '资料名称'],
    'Full name': ['성명', '全名'],
    'First name': ['이름', '名'],
    'Last name': ['성', '姓'],
    'Email': ['이메일', '邮箱'],
    'Phone': ['전화번호', '电话'],
    'LinkedIn URL': ['LinkedIn 주소', 'LinkedIn 链接'],
    'GitHub URL': ['GitHub 주소', 'GitHub 链接'],
    'Website / portfolio': ['웹사이트 / 포트폴리오', '网站 / 作品集'],
    'Pronouns': ['대명사', '代词'],
    'Location': ['위치', '所在地'],
    'Street address': ['도로명 주소', '街道地址'],
    'City': ['도시', '城市'],
    'State / province': ['주 / 도', '州 / 省'],
    'ZIP / postal code': ['우편번호', '邮政编码'],
    'Country': ['국가', '国家'],
    'Current role & expectations': ['현재 직무 및 희망 조건', '当前职位和期望'],
    'Headline / target title': ['헤드라인 / 희망 직무', '标题 / 目标职位'],
    'Current title': ['현재 직함', '当前职位'],
    'Current company': ['현재 회사', '当前公司'],
    'Years of experience': ['경력 연수', '工作年限'],
    'Salary expectation': ['희망 연봉', '期望薪资'],
    'Notice period / start date': ['입사 가능일', '通知期 / 入职日期'],
    'Countries you want to work in (comma separated)': ['근무 희망 국가 (쉼표로 구분)', '希望工作的国家（逗号分隔）'],
    'Work eligibility': ['취업 자격', '工作资格'],
    'Asked on almost every application': ['거의 모든 지원서에서 묻는 항목', '几乎每份申请都会问'],
    'Authorized to work in the country?': ['해당 국가 취업 허가가 있나요?', '是否有该国工作许可？'],
    'Needs visa sponsorship?': ['비자 스폰서가 필요한가요?', '是否需要签证担保？'],
    'Willing to relocate?': ['이주 가능한가요?', '是否愿意搬迁？'],
    'Screening questions': ['사전 질문', '筛选问题'],
    'Common Yes/No questions - answered once, used everywhere': ['자주 나오는 예/아니오 질문 - 한 번 답하면 어디서나 사용', '常见是/否问题 - 回答一次，处处可用'],
    'Are you 18 or older?': ['18세 이상인가요?', '是否年满 18 岁？'],
    'Can do essential job functions?': ['필수 직무를 수행할 수 있나요?', '能否履行基本职责？'],
    'Background check OK?': ['신원 조회 동의?', '是否接受背景调查？'],
    'Drug test OK?': ['약물 검사 동의?', '是否接受药检？'],
    'Contact current employer?': ['현 고용주에게 연락해도 되나요?', '可否联系现雇主？'],
    'Contact past employers?': ['이전 고용주에게 연락해도 되나요?', '可否联系前雇主？'],
    'Ever fired / asked to resign?': ['해고 / 권고사직 경험?', '是否曾被解雇 / 劝退？'],
    'Ever convicted of a crime?': ['범죄 유죄 판결 이력?', '是否有犯罪记录？'],
    'Bound by a non-compete?': ['경업금지 약정이 있나요?', '是否受竞业限制？'],
    'Relatives at the company?': ['회사에 친인척이 있나요?', '公司是否有亲属？'],
    'Worked there before?': ['이전에 근무한 적이 있나요?', '是否曾在此工作？'],
    'Voluntary self-identification': ['자발적 신상 정보', '自愿身份信息'],
    'Leave blank to let the form decline': ['비워 두면 양식에서 응답 거부로 처리됩니다', '留空则在表单中选择不披露'],
    'Gender': ['성별', '性别'],
    'Hispanic or Latino': ['히스패닉 또는 라틴계', '西班牙裔或拉丁裔'],
    'Race / ethnicity': ['인종 / 민족', '种族 / 民族'],
    'Veteran status': ['보훈 대상 여부', '退伍军人身份'],
    'Disability status': ['장애 여부', '残疾状况'],
    'Identify as LGBTQ+': ['LGBTQ+ 여부', '是否为 LGBTQ+'],
    'Not a valid .docx file': ['올바른 .docx 파일이 아닙니다', '不是有效的 .docx 文件'],
    'Deleted profile': ['삭제된 프로필', '已删除的资料'],

    // Applications
    'Export CSV': ['CSV 내보내기', '导出 CSV'],
    'Search title, company or site': ['직무, 회사 또는 사이트 검색', '搜索职位、公司或网站'],
    'All profiles': ['전체 프로필', '全部资料'],
    'All statuses': ['전체 상태', '全部状态'],
    'Date': ['날짜', '日期'],
    'Job': ['공고', '职位'],
    'Site': ['사이트', '网站'],
    'Status': ['상태', '状态'],
    'Applied': ['지원함', '已申请'],
    'Interview': ['면접', '面试'],
    'Offer': ['합격', '录用'],
    'Rejected': ['불합격', '被拒'],
    'No reply': ['응답 없음', '无回复'],
    'No matches': ['일치하는 항목 없음', '无匹配结果'],
    'No applications yet': ['아직 지원 내역이 없습니다', '暂无申请'],
    'Try a different search or filter.': ['다른 검색어나 필터를 사용해 보세요.', '请尝试其他搜索或筛选条件。'],
    'After you submit an application, log it from the popup or the prompt on the page.': ['지원서를 제출한 뒤 팝업이나 페이지 안내에서 기록하세요.', '提交申请后，可在弹窗或页面提示中记录。'],

    // Schedule
    'Plan who applies when, and track each block\'s goal.': ['누가 언제 지원할지 계획하고 시간대별 목표를 확인하세요.', '规划谁在何时申请，并跟踪每个时段的目标。'],
    'Add block': ['시간대 추가', '添加时段'],
    'Edit block': ['시간대 수정', '编辑时段'],
    'applications vs goal': ['지원 수 / 목표', '申请数 / 目标'],
    'Fill a sample week': ['예시 일주일 채우기', '填入示例一周'],
    'Switch profile automatically': ['프로필 자동 전환', '自动切换资料'],
    'When a block starts, make its profile the active one': ['시간대가 시작되면 해당 프로필로 전환', '时段开始时切换到对应资料'],
    'Reminders': ['알림', '提醒'],
    'Windows notification when a block starts (Chrome must be running)': ['시간대가 시작되면 Windows 알림 (Chrome 실행 중이어야 함)', '时段开始时发送 Windows 通知（需运行 Chrome）'],
    'Nothing scheduled today': ['오늘 일정이 없습니다', '今天没有安排'],
    'Add work blocks to plan which profile applies when.': ['작업 시간대를 추가해 어떤 프로필이 언제 지원할지 계획하세요.', '添加工作时段，规划各资料的申请时间。'],
    'Goal met': ['목표 달성', '已达成目标'],
    'Finished': ['완료', '已结束'],
    'Upcoming': ['예정', '即将开始'],
    'Partly': ['일부 달성', '部分完成'],
    'Missed': ['놓침', '未完成'],
    'Days': ['요일', '星期'],
    'Start': ['시작', '开始'],
    'End': ['종료', '结束'],
    'Apply as': ['지원 프로필', '申请资料'],
    'Goal (applications)': ['목표 (지원 수)', '目标（申请数）'],
    'Task / note (optional)': ['작업 / 메모 (선택)', '任务 / 备注（可选）'],
    'e.g. Dice + LinkedIn, Senior Data Engineer, remote': ['예: Dice + LinkedIn, 시니어 데이터 엔지니어, 원격', '例如：Dice + LinkedIn，高级数据工程师，远程'],

    // Daily log
    'What was done on each working day.': ['근무일마다 한 일을 확인합니다.', '每个工作日的完成情况。'],
    'Previous day': ['이전 날', '前一天'],
    'Next day': ['다음 날', '后一天'],
    'Goal reached': ['목표 달성률', '目标完成率'],
    'Active time': ['활동 시간', '活跃时间'],
    'Time between applications, not counting breaks over 45 minutes': ['지원 사이의 시간 (45분 넘는 휴식 제외)', '申请之间的时间（不计超过 45 分钟的休息）'],
    'Profiles worked': ['작업한 프로필', '使用的资料'],
    'Timeline': ['타임라인', '时间线'],
    'By profile': ['프로필별', '按资料'],
    'Schedule blocks': ['일정 시간대', '日程时段'],
    'By site': ['사이트별', '按网站'],
    'What went well, blockers, follow-ups...': ['잘된 점, 막힌 점, 후속 작업...', '进展、阻碍、后续事项...'],
    'Applied': ['지원함', '已申请'],
    'Goal': ['목표', '目标'],
    'Reached': ['달성', '完成'],
    'No applications logged': ['기록된 지원이 없습니다', '没有申请记录'],
    'Applications you log today show up here with their time.': ['오늘 기록한 지원이 시간과 함께 여기에 표시됩니다.', '今天记录的申请会连同时间显示在这里。'],
    'Nothing was logged on this day.': ['이 날은 기록이 없습니다.', '这一天没有记录。'],
    'No profiles scheduled or used.': ['예정되거나 사용된 프로필이 없습니다.', '没有安排或使用的资料。'],
    'No schedule blocks on this weekday.': ['이 요일에는 일정 시간대가 없습니다.', '这一天没有日程时段。'],
    'Plan one': ['계획하기', '去规划'],
    'No sites yet.': ['아직 사이트가 없습니다.', '暂无网站。'],

    // AI keys
    "Add several keys - they work together, and each one shows if it's live or dead.": ['여러 키를 추가하면 함께 동작하며, 각 키의 작동 여부가 표시됩니다.', '可添加多个密钥协同工作，每个密钥都会显示是否可用。'],
    'Check all keys': ['모든 키 확인', '检查所有密钥'],
    'Add key': ['키 추가', '添加密钥'],
    'Where to get keys': ['키 발급처', '获取密钥'],
    'Provider': ['제공자', '提供商'],
    'Paste an API key': ['API 키 붙여넣기', '粘贴 API 密钥'],
    'API key': ['API 키', 'API 密钥'],
    'Show / hide': ['표시 / 숨기기', '显示 / 隐藏'],
    'No AI keys': ['AI 키 없음', '没有 AI 密钥'],
    'No API keys yet': ['아직 API 키가 없습니다', '暂无 API 密钥'],
    'Add one below. Groq and OpenRouter are free.': ['아래에서 추가하세요. Groq와 OpenRouter는 무료입니다.', '请在下方添加。Groq 和 OpenRouter 免费。'],
    'Get key': ['키 받기', '获取密钥'],
    'Failover': ['장애 시 전환', '故障切换'],
    'Rotate': ['순환', '轮换'],
    'First choice': ['우선 사용', '首选'],
    'Live': ['작동', '可用'],
    'Dead': ['작동 안 함', '不可用'],
    'Off': ['꺼짐', '已关闭'],
    'Not checked': ['확인 안 함', '未检查'],
    'Not checked yet': ['아직 확인하지 않음', '尚未检查'],
    'Turned off - not used': ['꺼짐 - 사용 안 함', '已关闭 - 不使用'],
    'Reload model list...': ['모델 목록 새로고침...', '重新加载模型列表...'],
    'Load model list...': ['모델 목록 불러오기...', '加载模型列表...'],
    'Custom model name...': ['모델 이름 직접 입력...', '自定义模型名称...'],
    'Add a key first.': ['먼저 키를 추가하세요.', '请先添加密钥。'],
    'Free': ['무료', '免费'],

    // Settings
    'Appearance': ['화면', '外观'],
    'Theme': ['테마', '主题'],
    'Applies to the dashboard, popup, side panel and notifications on job sites': ['대시보드, 팝업, 사이드 패널, 채용 사이트 알림에 적용됩니다', '应用于控制台、弹窗、侧边栏和招聘网站通知'],
    'Light': ['라이트', '浅色'],
    'Dark': ['다크', '深色'],
    'System': ['시스템', '跟随系统'],
    'Autofill': ['자동 입력', '自动填写'],
    'Use AI for questions': ['질문에 AI 사용', '用 AI 回答问题'],
    "Answer fields the profile can't, using the job description": ['프로필로 답할 수 없는 항목을 채용 공고를 바탕으로 답변', '根据职位描述回答资料无法回答的字段'],
    'AI time limit': ['AI 시간 제한', 'AI 时间限制'],
    "If the AI hasn't answered by then, skip it and add the questions to Saved answers": ['그때까지 AI가 답하지 않으면 건너뛰고 질문을 저장된 답변에 추가', '若 AI 到时未回答，则跳过并将问题加入已保存的回答'],
    '5 seconds': ['5초', '5 秒'], '10 seconds': ['10초', '10 秒'], '20 seconds': ['20초', '20 秒'], '45 seconds': ['45초', '45 秒'],
    'Overwrite filled fields': ['채워진 항목 덮어쓰기', '覆盖已填字段'],
    'Replace values the site already pre-filled': ['사이트가 미리 채운 값을 바꿉니다', '替换网站预填的值'],
    'Side panel on application forms': ['지원서 사이드 패널', '申请表侧边栏'],
    'Job match, required fields checklist and actions next to the form': ['양식 옆에 직무 적합도, 필수 항목 체크리스트, 작업 버튼 표시', '在表单旁显示职位匹配度、必填项清单和操作'],
    'Floating Fill button': ['떠 있는 입력 버튼', '悬浮填写按钮'],
    'Used when the side panel is off': ['사이드 패널이 꺼져 있을 때 사용', '侧边栏关闭时使用'],
    'Remember my answers': ['내 답변 기억하기', '记住我的回答'],
    'When you answer a question on a form yourself, save it to the profile and fill it automatically next time': ['양식에서 직접 답한 질문을 프로필에 저장하고 다음부터 자동 입력', '你在表单中亲自回答的问题会保存到资料，下次自动填写'],
    'Offer to log after submitting': ['제출 후 기록 제안', '提交后提示记录'],
    'When you click Submit / Apply, ask to save the job to the tracker': ['제출 / 지원 버튼을 누르면 지원 내역에 저장할지 묻기', '点击提交 / 申请时，询问是否保存到记录'],
    'Data & other Chromes': ['데이터 및 다른 Chrome', '数据和其他 Chrome'],
    'Backup': ['백업', '备份'],
    'Profiles, resume files, saved answers and history in one file': ['프로필, 이력서 파일, 저장된 답변, 기록을 한 파일에', '资料、简历文件、已保存回答和记录合为一个文件'],
    'Clear application history': ['지원 기록 지우기', '清除申请记录'],
    'Profiles and resumes are kept': ['프로필과 이력서는 유지됩니다', '资料和简历会保留'],
    'Everything is stored locally in Chrome on this computer (and in your data file, if connected). Only profile text, resume text and job descriptions are sent to the AI provider you choose.': ['모든 데이터는 이 컴퓨터의 Chrome(연결한 경우 데이터 파일)에만 저장됩니다. 프로필·이력서 텍스트와 채용 공고만 선택한 AI 제공자에게 전송됩니다.', '所有数据都保存在本机 Chrome 中（若已连接，也保存在数据文件中）。只有资料文本、简历文本和职位描述会发送给你选择的 AI 提供商。'],
    'Backup restored.': ['백업을 복원했습니다.', '备份已恢复。'],
    'History cleared.': ['기록을 지웠습니다.', '记录已清除。'],
    'Data file': ['데이터 파일', '数据文件'],
    'Data file needs permission': ['데이터 파일 권한 필요', '数据文件需要权限'],
    'Reconnect': ['다시 연결', '重新连接'],
    'Disconnect': ['연결 끊기', '断开连接'],
    'Sync now': ['지금 동기화', '立即同步'],
    'Open existing data file': ['기존 데이터 파일 열기', '打开现有数据文件'],
    'Open existing data file...': ['기존 데이터 파일 열기...', '打开现有数据文件...'],
    'Create data file...': ['데이터 파일 만들기...', '创建数据文件...'],
    'Not connected': ['연결 안 됨', '未连接'],
    'Needs permission': ['권한 필요', '需要权限'],
    'Auto-saving': ['자동 저장 중', '自动保存中'],
    'Error': ['오류', '错误'],
    'Not supported in this browser': ['이 브라우저에서는 지원되지 않습니다', '此浏览器不支持'],
    'The file contains your API keys and resumes, so keep it private.': ['이 파일에는 API 키와 이력서가 들어 있으니 비공개로 보관하세요.', '该文件包含你的 API 密钥和简历，请妥善保管。'],
    'One JSON file with all JobBid data: profiles, resume files, saved answers, applications, schedule, notes and settings.': ['모든 JobBid 데이터를 담은 JSON 파일 하나: 프로필, 이력서 파일, 저장된 답변, 지원 내역, 일정, 메모, 설정.', '包含全部 JobBid 数据的一个 JSON 文件：资料、简历文件、已保存回答、申请、日程、备注和设置。'],
    'Loaded the latest data from the file.': ['파일에서 최신 데이터를 불러왔습니다.', '已从文件加载最新数据。'],
    'Saved to the data file.': ['데이터 파일에 저장했습니다.', '已保存到数据文件。'],

    // Side panel (job sites)
    'Log application': ['지원 기록', '记录申请'],
    'Already applied': ['이미 지원함', '已申请过'],
    'Required': ['필수', '必填'],
    'Optional': ['선택', '选填'],
    'No form fields found yet.': ['아직 양식 항목이 없습니다.', '尚未找到表单字段。'],
    'required fields filled': ['개 필수 항목 입력됨', '个必填项已填写'],
    'Cover letter failed': ['자기소개서 작성 실패', '求职信生成失败'],
    'Hide panel': ['패널 숨기기', '隐藏面板'],
    'Open JobBid panel': ['JobBid 패널 열기', '打开 JobBid 面板'],
    'Filling...': ['입력 중...', '正在填写...'],
    'Copied': ['복사됨', '已复制'],

    // AI status / disabled AI
    'AI not working': ['AI 작동 안 함', 'AI 无法使用'],
    'AI not working · no key': ['AI 작동 안 함 · 키 없음', 'AI 无法使用 · 无密钥'],
    'AI not working · keys failed': ['AI 작동 안 함 · 키 오류', 'AI 无法使用 · 密钥失效'],
    'Needs an AI key': ['AI 키 필요', '需要 AI 密钥'],
    'Add a key': ['키 추가', '添加密钥'],
    'Fix keys': ['키 확인', '检查密钥'],
    'Add an AI key in the dashboard to write cover letters': ['자기소개서를 쓰려면 대시보드에서 AI 키를 추가하세요', '请在控制台添加 AI 密钥以撰写求职信'],
    'No API key - AI answers and cover letters are off. Click to add a key.': ['API 키가 없어 AI 답변과 자기소개서가 꺼져 있습니다. 클릭해서 키를 추가하세요.', '没有 API 密钥，AI 回答和求职信已关闭。点击添加密钥。'],
    'No API key, so AI answers and cover letters are turned off. Profile answers still fill normally.': ['API 키가 없어 AI 답변과 자기소개서가 꺼져 있습니다. 프로필 답변은 그대로 입력됩니다.', '没有 API 密钥，AI 回答和求职信已关闭。资料中的回答仍会正常填写。'],
    'No API key - AI answers and cover letters are off. Profile answers still fill.': ['API 키가 없어 AI 답변과 자기소개서가 꺼져 있습니다. 프로필 답변은 입력됩니다.', '没有 API 密钥，AI 回答和求职信已关闭。资料回答仍会填写。'],
    'Every key failed on its last call. Check the keys or add another one.': ['모든 키가 마지막 호출에서 실패했습니다. 키를 확인하거나 새 키를 추가하세요.', '所有密钥在上次调用时都失败了。请检查密钥或添加新密钥。'],
    'Every AI key failed on its last call.': ['모든 AI 키가 마지막 호출에서 실패했습니다.', '所有 AI 密钥在上次调用时都失败了。'],
    'Every key failed on its last call - check the errors below or add another key.': ['모든 키가 마지막 호출에서 실패했습니다 - 아래 오류를 확인하거나 키를 추가하세요.', '所有密钥在上次调用时都失败了 - 请查看下方错误或添加密钥。'],
    'AI not working - add an API key on the AI keys page to turn this on.': ['AI 작동 안 함 - AI 키 페이지에서 API 키를 추가하면 켤 수 있습니다.', 'AI 无法使用 - 在 AI 密钥页面添加 API 密钥后即可开启。'],
    'AI answers are turned off in Settings.': ['설정에서 AI 답변이 꺼져 있습니다.', 'AI 回答已在设置中关闭。'],
    'Failover: the first live key is used; if it fails or hits a limit, the next one takes over instantly.': ['장애 시 전환: 작동하는 첫 번째 키를 쓰고, 실패하거나 한도에 걸리면 즉시 다음 키로 넘어갑니다.', '故障切换：使用第一个可用密钥；若失败或达到限额，立即切换到下一个。'],
    'Rotate: requests are spread across all live keys; if one fails, the next one is used.': ['순환: 요청을 작동하는 모든 키에 나눠 보내고, 하나가 실패하면 다음 키를 씁니다.', '轮换：请求分散到所有可用密钥；某个失败时使用下一个。'],
    'How keys are used': ['키 사용 방식', '密钥使用方式'],
    'Free models': ['무료 모델', '免费模型'],
    'Free in some regions': ['일부 지역 무료', '部分地区免费'],
    'Paid': ['유료', '付费'],
    'Very fast Llama, Qwen and GPT-OSS models. Free tier, no card.': ['매우 빠른 Llama, Qwen, GPT-OSS 모델. 무료 요금제, 카드 불필요.', '极快的 Llama、Qwen 和 GPT-OSS 模型。免费套餐，无需银行卡。'],
    'Hundreds of models. Free ones end in ":free" and have a daily limit.': ['수백 개의 모델. 무료 모델은 ":free"로 끝나며 일일 한도가 있습니다.', '数百个模型。免费模型以 ":free" 结尾，有每日限额。'],
    'Free tier is not available for every country or project.': ['무료 요금제는 모든 국가나 프로젝트에서 제공되지 않습니다.', '免费套餐并非所有国家或项目都可用。'],
    'Grok models. Needs prepaid credits on your xAI account.': ['Grok 모델. xAI 계정에 선불 크레딧이 필요합니다.', 'Grok 模型。需要在 xAI 账户中预充值。'],
    'Saved.': ['저장했습니다.', '已保存。'],
    'Writing...': ['작성 중...', '撰写中...'],
    'Now': ['진행 중', '进行中'],

    // Model picker
    'Model': ['모델', '模型'],
    'Recommended': ['추천', '推荐'],
    'More': ['더 보기', '更多'],
    'Load all models...': ['전체 모델 불러오기...', '加载全部模型...'],
    'Model for this key': ['이 키에 쓸 모델', '此密钥使用的模型'],

    // IP address
    'Your IP': ['내 IP', '我的 IP'],
    'Checking IP...': ['IP 확인 중...', '正在检查 IP...'],
    'IP unknown': ['IP 알 수 없음', 'IP 未知'],
    'Click to check again': ['클릭하면 다시 확인합니다', '点击重新检查'],
    'Matches the profile country': ['프로필 국가와 일치', '与资料国家一致'],
    'Could not look up your IP address (offline?)': ['IP 주소를 확인할 수 없습니다 (오프라인?)', '无法查询你的 IP 地址（离线？）'],

    // Notifications on job sites
    'Filled by JobBid from profile': ['JobBid가 프로필에서 입력함', '由 JobBid 根据资料填写'],
    'Filled by JobBid AI - please review': ['JobBid AI가 입력함 - 확인해 주세요', '由 JobBid AI 填写 - 请检查'],
    'Required - JobBid could not fill this': ['필수 - JobBid가 입력하지 못함', '必填 - JobBid 无法填写'],
    'No profile yet': ['아직 프로필이 없습니다', '暂无资料'],
    'Open the JobBid dashboard and import a resume.': ['JobBid 대시보드를 열고 이력서를 가져오세요.', '请打开 JobBid 控制台并导入简历。'],
    'No form on this page': ['이 페이지에 양식이 없습니다', '此页面没有表单'],
    'Click the Apply button on the job first, then fill.': ['먼저 공고의 지원 버튼을 누른 뒤 입력하세요.', '请先点击职位的申请按钮，再进行填写。'],
    'Nothing to fill here': ['입력할 항목이 없습니다', '这里没有可填写的内容'],
    'Review everything, then submit.': ['모두 확인한 뒤 제출하세요.', '请检查所有内容后再提交。'],
    'Already in your tracker': ['이미 지원 내역에 있습니다', '已在你的记录中'],
    'Application logged': ['지원을 기록했습니다', '申请已记录'],
    'Could not log': ['기록하지 못했습니다', '无法记录'],
    'Did you submit this application?': ['이 지원서를 제출했나요?', '你提交这份申请了吗？'],
    'Log it so you never apply to the same job twice.': ['기록해 두면 같은 공고에 두 번 지원하지 않습니다.', '记录下来，避免重复申请同一职位。'],
    'Log it': ['기록하기', '记录'],
    'Not yet': ['아직 아님', '还没有'],
    'Undo': ['실행 취소', '撤销'],
    'Done': ['완료', '完成'],
    'Heads up': ['알림', '提示'],
    'Something went wrong': ['문제가 발생했습니다', '出错了'],
    'Extension error': ['확장 프로그램 오류', '扩展程序错误'],
    'Hide on this page': ['이 페이지에서 숨기기', '在此页面隐藏'],
    'Fill this application (Alt+Shift+F)': ['이 지원서 자동 입력 (Alt+Shift+F)', '填写此申请（Alt+Shift+F）'],
    'Active profile - change it in the JobBid popup': ['사용 중인 프로필 - JobBid 팝업에서 변경', '当前资料 - 可在 JobBid 弹窗中更改'],
    'Click the JobBid icon in the Chrome toolbar to change who you are applying as.': ['Chrome 도구 모음의 JobBid 아이콘을 눌러 지원 프로필을 바꾸세요.', '点击 Chrome 工具栏中的 JobBid 图标以更改申请人。'],
    // ---- Added: remaining fixed text ----
    'To use JobBid in another Chrome (another profile or computer): save the file in a OneDrive / Google Drive / Dropbox folder, install JobBid there, and choose':
      ['다른 Chrome(다른 프로필 또는 컴퓨터)에서 JobBid를 쓰려면 파일을 OneDrive / Google Drive / Dropbox 폴더에 저장하고, 그곳에 JobBid를 설치한 뒤 다음을 선택하세요:',
       '要在另一个 Chrome（其他配置文件或电脑）中使用 JobBid：把文件保存到 OneDrive / Google Drive / Dropbox 文件夹，在那里安装 JobBid，然后选择'],
    '. Changes from either Chrome are picked up automatically.': ['. 어느 Chrome에서 변경해도 자동으로 반영됩니다.', '。任一 Chrome 中的更改都会自动同步。'],
    'Chrome asks again after a restart. Click Reconnect so changes keep saving to the data file.':
      ['Chrome을 다시 시작하면 다시 묻습니다. 다시 연결을 눌러 변경 내용이 데이터 파일에 계속 저장되게 하세요.', 'Chrome 重启后会再次询问。点击“重新连接”，让更改继续保存到数据文件。'],
    'Add position': ['경력 추가', '添加工作经历'],
    'Add school': ['학교 추가', '添加学校'],
    'Add skills, comma separated': ['기술 추가 (쉼표로 구분)', '添加技能（用逗号分隔）'],
    'Delete profile': ['프로필 삭제', '删除个人资料'],
    'Start month': ['시작 월', '开始月份'], 'End month': ['종료 월', '结束月份'],
    'Start year': ['시작 연도', '开始年份'], 'End year': ['종료 연도', '结束年份'],
    'Year': ['연도', '年份'],
    'English': ['English', 'English'],
    'Field of study': ['전공', '专业'],
    'Highlights': ['주요 성과', '工作亮点'],
    'Title': ['직함', '职位'],
    'Move up (try earlier)': ['위로 (먼저 사용)', '上移（优先使用）'],
    'Move down (try later)': ['아래로 (나중에 사용)', '下移（稍后使用）'],
    'Open the daily log': ['일일 기록 열기', '打开每日记录'],
    'Remove': ['삭제', '移除'],
    'Remove key': ['키 삭제', '删除密钥'],
    'Use this key': ['이 키 사용', '使用此密钥'],
    'Type answer...': ['답변 입력...', '输入答案...'],
    'Choose answer...': ['답변 선택...', '选择答案...'],
    'Use on sites, e.g. dice.com': ['사용할 사이트 (예: dice.com)', '用于的网站，例如 dice.com'],
    'What went well, blockers, follow-ups...': ['잘된 점, 문제점, 후속 작업...', '进展顺利的地方、遇到的问题、后续事项...'],
    'Matches the profile country': ['프로필 국가와 일치', '与个人资料国家一致'],
    'Click to check again': ['클릭하여 다시 확인', '点击重新检查'],
    'Yes': ['예', '是'], 'No': ['아니요', '否'],
    // Self-identification choices (display only; saved values stay English)
    'Male': ['남성', '男'], 'Female': ['여성', '女'], 'Non-binary': ['논바이너리', '非二元性别'],
    'Decline to self-identify': ['밝히지 않음', '不愿透露'],
    'I do not wish to answer': ['답변하지 않음', '不愿回答'],
    'White': ['백인', '白人'], 'Asian': ['아시아인', '亚裔'], 'Black or African American': ['흑인 또는 아프리카계 미국인', '黑人或非裔美国人'],
    'Hispanic or Latino': ['히스패닉 또는 라틴계', '西班牙裔或拉丁裔'],
    'American Indian or Alaska Native': ['아메리칸 원주민 또는 알래스카 원주민', '美洲印第安人或阿拉斯加原住民'],
    'Native Hawaiian or Other Pacific Islander': ['하와이 원주민 또는 기타 태평양 섬 주민', '夏威夷原住民或其他太平洋岛民'],
    'Two or More Races': ['두 개 이상의 인종', '两个或以上种族'],
    'I am not a protected veteran': ['보호 대상 재향군인이 아님', '我不是受保护的退伍军人'],
    'I identify as one or more of the classifications of protected veteran': ['보호 대상 재향군인 분류에 하나 이상 해당함', '我属于一种或多种受保护退伍军人类别'],
    'No, I do not have a disability': ['아니요, 장애가 없습니다', '否，我没有残疾'],
    'Yes, I have a disability (or previously had a disability)': ['예, 장애가 있습니다 (또는 과거에 있었습니다)', '是，我有残疾（或曾有残疾）'],
    // Months (education / experience pickers)
    'Jan': ['1월', '1月'], 'Feb': ['2월', '2月'], 'Mar': ['3월', '3月'], 'Apr': ['4월', '4月'], 'May': ['5월', '5月'], 'Jun': ['6월', '6月'],
    'Jul': ['7월', '7月'], 'Aug': ['8월', '8月'], 'Sep': ['9월', '9月'], 'Oct': ['10월', '10月'], 'Nov': ['11월', '11月'], 'Dec': ['12월', '12月'],
    // ---- Fill blanks from a new resume ----
    'New resume added': ['새 이력서가 추가되었습니다', '已添加新简历'],
    'Not now': ['나중에', '暂不'],
    'Check with AI': ['AI로 확인', '用 AI 检查'],
    'Check resume': ['이력서 확인', '检查简历'],
    'Checking resume...': ['이력서 확인 중...', '正在检查简历...'],
    'AI is reading the resume...': ['AI가 이력서를 읽는 중...', 'AI 正在读取简历...'],
    'Reading the resume...': ['이력서를 읽는 중...', '正在读取简历...'],
    'Cancel': ['취소', '取消'], 'Close': ['닫기', '关闭'],
    'Could not check resume': ['이력서를 확인할 수 없습니다', '无法检查简历'],
    'No blanks to fill': ['채울 빈칸이 없습니다', '没有需要填写的空白'],
    'Fill selected': ['선택 항목 채우기', '填写所选项'],
    'Check this resume with AI and fill the empty fields in this profile?': ['이 이력서를 AI로 확인하고 이 프로필의 빈 항목을 채울까요?', '用 AI 检查此简历并填写此资料中的空白项吗？'],
    'Check this resume and fill the empty fields in this profile?': ['이 이력서를 확인하고 이 프로필의 빈 항목을 채울까요?', '检查此简历并填写此资料中的空白项吗？'],
    'Fill blanks': ['빈칸 채우기', '填写空白'],
    'Read this resume and fill empty profile fields': ['이 이력서를 읽고 프로필의 빈 항목을 채웁니다', '读取此简历并填写资料中的空白项'],
    'Only empty fields are filled, and you choose which ones. Nothing you already entered is changed.':
      ['빈 항목만 채우며, 어떤 항목을 채울지 직접 고릅니다. 이미 입력한 내용은 바뀌지 않습니다.', '只填写空白项，并由你选择填写哪些。已填写的内容不会被更改。'],
    'No AI key: only contact details and links were checked.': ['AI 키 없음: 연락처와 링크만 확인했습니다.', '没有 AI 密钥：只检查了联系方式和链接。'],
    "No AI key: the resume is read with JobBid's built-in reader (headline, location, skills, jobs, education).": ['AI 키 없음: JobBid 내장 리더로 이력서를 읽습니다 (직함, 위치, 기술, 경력, 학력).', '没有 AI 密钥：使用 JobBid 内置读取器读取简历（职位、地点、技能、工作经历、教育）。'],
    'New position': ['새 경력', '新工作经历'], 'New education': ['새 학력', '新教育经历'],
    'Position details': ['경력 세부 정보', '工作经历详情'], 'Education details': ['학력 세부 정보', '教育经历详情'],
    'Professional summary': ['자기소개 요약', '个人简介'],
    // ---- Side panel tabs ----
    'Apply': ['지원', '申请'], 'Job details': ['공고 정보', '职位详情'], 'Skill match': ['기술 일치도', '技能匹配'],
    'Analyzed by AI': ['AI 분석 결과', '由 AI 分析'], 'Re-analyze': ['다시 분석', '重新分析'],
    'Match': ['매칭', '匹配'], 'Full match': ['전체 매칭', '完整匹配'], 'Strong match': ['매우 적합', '高度匹配'], 'Good match': ['적합', '较匹配'],
    'Fair match': ['보통', '一般匹配'], 'Low match': ['낮음', '匹配度低'], 'Experience level': ['경력 수준', '经验水平'], 'Skills': ['기술', '技能'],
    'Industry experience': ['산업 경험', '行业经验'], 'Industry': ['산업', '行业'], 'Resume ATS score': ['이력서 ATS 점수', '简历 ATS 分数'],
    'Job keywords written in the profile/resume, title and industry': ['프로필/이력서에 적힌 공고 키워드, 직함, 산업', '资料/简历中出现的职位关键词、职位名称和行业'],
    'Under 6.0 is often filtered out by an ATS.': ['6.0 미만은 ATS에서 걸러지는 경우가 많습니다.', '低于 6.0 常被 ATS 过滤。'],
    'Strengths': ['강점', '优势'], 'Gaps': ['부족한 점', '不足'], 'How to improve': ['개선 방법', '改进建议'],
    'Score with AI': ['AI로 점수 매기기', '用 AI 评分'], 'Re-score': ['다시 점수 매기기', '重新评分'], 'Scored by AI': ['AI 점수', '由 AI 评分'],
    'Quick score from the page and profile': ['페이지와 프로필로 계산한 빠른 점수', '根据页面和资料快速评分'], 'AI is scoring the match...': ['AI가 매칭 점수를 계산하는 중...', 'AI 正在评分...'],
    'Details read from the page': ['페이지에서 읽은 정보', '从页面读取的信息'],
    'AI unavailable - details read from the page': ['AI 사용 불가 - 페이지에서 읽은 정보', 'AI 不可用 - 从页面读取的信息'],
    'Understanding job context...': ['공고 내용을 파악하는 중...', '正在理解职位内容...'],
    'No company listed': ['회사 정보 없음', '未列出公司'], 'Location not listed': ['근무지 정보 없음', '未列出地点'],
    'Level not listed': ['직급 정보 없음', '未列出级别'], 'Type not listed': ['고용 형태 정보 없음', '未列出类型'],
    'Salary not listed': ['급여 정보 없음', '未列出薪资'], 'Post date not listed': ['게시일 정보 없음', '未列出发布日期'],
    'Applying as': ['지원 프로필', '申请身份'], 'Profile details': ['프로필 정보', '资料详情'],
    'Work authorization': ['취업 자격', '工作许可'], 'Sponsorship': ['비자 후원', '签证担保'],
    'Edit profile': ['프로필 편집', '编辑资料'], 'Language': ['언어', '语言'],
    'Copy debug info (for reporting a problem)': ['디버그 정보 복사 (문제 신고용)', '复制调试信息（用于报告问题）'],
    'Hide panel': ['패널 숨기기', '隐藏面板'], 'Open JobBid panel': ['JobBid 패널 열기', '打开 JobBid 面板'],
    'Debug info copied': ['디버그 정보를 복사했습니다', '已复制调试信息'], 'Paste it when you report the problem.': ['문제를 신고할 때 붙여 넣으세요.', '报告问题时粘贴即可。'],
    'Could not copy': ['복사할 수 없습니다', '无法复制'],
    "No application form on this page yet. Click the job's Apply button, then come back to this tab.":
      ['이 페이지에는 아직 지원서 양식이 없습니다. 공고의 지원 버튼을 누른 뒤 이 탭으로 돌아오세요.', '此页面还没有申请表。点击职位的“申请”按钮后再回到此标签。'],
    'Hybrid': ['하이브리드', '混合办公'], 'Remote': ['원격', '远程'], 'On-site': ['출근', '现场办公'],
    'Full-time': ['정규직', '全职'], 'Part-time': ['파트타임', '兼职'], 'Contract': ['계약직', '合同工'], 'Internship': ['인턴십', '实习'],
    'Entry': ['신입', '初级'], 'Junior': ['주니어', '初级'], 'Mid': ['중급', '中级'], 'Senior': ['시니어', '高级'], 'Staff': ['스태프', '资深'],
    'Lead': ['리드', '主管'], 'Principal': ['수석', '首席'], 'Director': ['디렉터', '总监'], 'Intern': ['인턴', '实习生'],
    ': the blanks are filled automatically without AI, and you can undo it.': [': AI 없이 빈칸을 자동으로 채우며, 되돌릴 수 있습니다.', '：不使用 AI 自动填写空白，并且可以撤销。'],
    'Undo': ['되돌리기', '撤销'], 'OK': ['확인', '确定'],
    'Side panel position': ['사이드 패널 위치', '侧边栏位置'], 'Which side of the page the panel docks on': ['패널을 페이지 어느 쪽에 붙일지', '面板停靠在页面的哪一侧'],
    'Left': ['왼쪽', '左侧'], 'Right': ['오른쪽', '右侧'],
    'Push the page aside': ['페이지를 옆으로 밀기', '把页面推到一侧'],
    'Make room for the panel so it never covers the form. Turn off if a site looks broken.': ['패널이 양식을 가리지 않도록 공간을 만듭니다. 사이트가 깨져 보이면 끄세요.', '为面板腾出空间，避免遮挡表单。如果网站显示异常，请关闭。'],
    'Type the date as MM/DD/YYYY': ['날짜를 MM/DD/YYYY 형식으로 입력하세요', '请按 MM/DD/YYYY 格式输入日期'],
    'Pick from calendar': ['달력에서 선택', '从日历中选择'],
    'Already applied to this job': ['이미 지원한 공고입니다', '已申请过此职位'], 'Another profile already applied': ['다른 프로필이 이미 지원했습니다', '其他资料已申请过'],
    'Apply anyway': ['그래도 지원', '仍然申请'],
    '+ Save unanswered questions for later': ['+ 답하지 못한 질문을 나중을 위해 저장', '+ 保存未回答的问题以备后用'],
    'No new questions to save': ['저장할 새 질문이 없습니다', '没有需要保存的新问题'],
    'Dashboard & settings': ['대시보드 및 설정', '控制台和设置'],
    'Auto-submit when complete': ['완료되면 자동 제출', '填写完整后自动提交'],
    "After Fill, if no required field is empty: wait 1 second (with Cancel), then press the form's Submit button and log the application. Never presses Next / Continue.": ['채우기 후 비어 있는 필수 항목이 없으면 1초 대기(취소 가능) 후 양식의 제출 버튼을 누르고 지원을 기록합니다. 다음/계속 버튼은 누르지 않습니다.', '填写后如果没有空的必填项：等待 1 秒（可取消），然后点击表单的提交按钮并记录申请。不会点击“下一步/继续”。'],
    'Submit now': ['지금 제출', '立即提交'],
    'Auto-submit skipped': ['자동 제출 건너뜀', '已跳过自动提交'],
    'Auto-submit stopped': ['자동 제출 중지됨', '自动提交已停止'],
    'A required field became empty. Check the form, then submit yourself.': ['필수 항목이 비었습니다. 양식을 확인한 뒤 직접 제출하세요.', '有必填项变为空。请检查表单后自行提交。'],
    'Manage profiles': ['프로필 관리', '管理资料'],
    'No resume file': ['이력서 파일 없음', '没有简历文件'],
    'Today by profile': ['오늘 프로필별', '今日各资料'],
    'Needs attention': ['확인 필요', '需要处理'],
    'All good - nothing needs attention.': ['모두 정상 - 확인할 것이 없습니다.', '一切正常 - 没有需要处理的事项。'],
    'No applications or goals today. Plan blocks in Schedule to set daily goals.': ['오늘 지원이나 목표가 없습니다. 일정에서 블록을 계획해 하루 목표를 정하세요.', '今天没有申请或目标。在日程中安排时段来设定每日目标。'],
    'Filling': ['채우기', '填写'],
    'Side panel': ['사이드 패널', '侧边面板'],
    'After filling': ['채운 후', '填写后'],
    'AI': ['AI', 'AI'],
    'Fix': ['수정', '修复'],
    'Answer': ['답변', '回答'],
    'Clean up': ['정리', '清理'],
    'Add': ['추가', '添加'],
    'Complete': ['완성', '完善'],
    'No AI key - profile and saved answers still fill': ['AI 키 없음 - 프로필과 저장된 답변은 계속 채워집니다', '没有 AI 密钥 - 资料和已保存答案仍会填写'],
    'Open the side panel by default': ['기본으로 사이드 패널 열기', '默认打开侧边面板'],
    'On every page JobBid shows the full panel or, when hidden, a small button on the page edge. Hide / show any time with ‹ and that button.': ['모든 페이지에서 전체 패널을 보여주거나, 숨기면 페이지 가장자리에 작은 버튼을 표시합니다. ‹ 와 그 버튼으로 언제든 숨기거나 열 수 있습니다.', '每个页面都会显示完整面板，隐藏时则在页面边缘显示一个小按钮。可随时用 ‹ 和该按钮隐藏或打开。'],
    'A Fill button on application forms, handy while the panel is hidden': ['지원 양식의 채우기 버튼 - 패널을 숨겼을 때 편리합니다', '申请表上的填写按钮，面板隐藏时很方便'],
    'You already applied before!': ['이미 지원한 공고입니다!', '您之前已申请过！'],
    'Import a resume to start': ['이력서를 가져와 시작하세요', '导入简历开始'],
    'Remove duplicates': ['중복 제거', '删除重复项'],
    'Resume': ['이력서', '简历'],
    'Not attached': ['첨부 안 됨', '未附加'],
    'Attach': ['첨부', '附加'],
    'Replace': ['교체', '替换'],
    'Attaching...': ['첨부 중...', '正在附加...'],
    'Attached': ['첨부됨', '已附加'],
    'Could not attach the resume': ['이력서를 첨부할 수 없습니다', '无法附加简历'],
    "Use the site's own upload button for this form.": ['이 양식은 사이트의 업로드 버튼을 사용하세요.', '此表单请使用网站自带的上传按钮。'],
    'Add a profile in the dashboard to start applying.': ['대시보드에서 프로필을 추가하면 지원을 시작할 수 있습니다.', '在控制台添加资料后即可开始申请。'],
    'Open JobBid · form complete': ['JobBid 열기 · 양식 완료', '打开 JobBid · 表单已完成'],
    'Copy debug info': ['디버그 정보 복사', '复制调试信息'],
    'Save unanswered questions': ['답하지 못한 질문 저장', '保存未回答的问题'],
    'Add every unanswered question on this page to Saved answers': ['이 페이지의 답하지 못한 질문을 모두 저장된 답변에 추가', '将此页所有未回答的问题添加到已保存答案'],
    '1 field needs you - go to next': ['직접 입력할 항목 1개 - 이동', '1 个字段需要您填写 - 前往'],
    '· profile and saved answers still fill.': ['· 프로필과 저장된 답변은 계속 채워집니다.', '· 资料和已保存答案仍会填写。'],
    '· every key failed.': ['· 모든 키가 실패했습니다.', '· 所有密钥都失败了。'],
    'Reconnect': ['다시 연결', '重新连接'],
    'Every unanswered question here is already in Saved answers or comes from the profile.': ['여기서 답하지 못한 질문은 모두 이미 저장된 답변에 있거나 프로필에서 채워집니다.', '这里未回答的问题都已在已保存答案中，或由资料填写。'],
    'Reconnect your JobBid data file': ['JobBid 데이터 파일 다시 연결', '重新连接 JobBid 数据文件'],
    'Chrome needs your OK to read the data file after a restart. Click here, then click anywhere in the dashboard.': ['재시작 후 Chrome이 데이터 파일을 읽으려면 허용이 필요합니다. 여기를 클릭한 다음 대시보드 아무 곳이나 클릭하세요.', 'Chrome 重启后需要您允许读取数据文件。点击这里，然后在控制台任意位置点击。'],
    'Already use JobBid in another Chrome?': ['다른 Chrome에서 이미 JobBid를 사용 중인가요?', '已经在另一个 Chrome 中使用 JobBid？'],
    'Open your data file to load all profiles, saved answers and applications.': ['데이터 파일을 열어 모든 프로필, 저장된 답변, 지원 기록을 불러오세요.', '打开数据文件以加载所有资料、已保存答案和申请记录。'],
    'Open data file...': ['데이터 파일 열기...', '打开数据文件...'],
  };

  // Text with numbers or names in it: [regex, ko(...groups), zh(...groups)]
  const P = [
    [/^Fill (\d+) fields?( \+ resume)?$/, (n, r) => `${n}개 항목${r ? ' + 이력서' : ''} 입력`, (n, r) => `填写 ${n} 个字段${r ? ' + 简历' : ''}`],
    [/^(\d+) of (\d+) done$/, (a, b) => `${b}개 중 ${a}개 완료`, (a, b) => `已完成 ${a} / ${b}`],
    [/^(.*) · (\d+)% complete$/, (h, n) => `${h} · ${n}% 완성`, (h, n) => `${h} · 完成 ${n}%`],
    [/^Profile (\d+)% complete$/, (n) => `프로필 ${n}% 완성`, (n) => `资料完成 ${n}%`],
    [/^Scheduled now: ?(.*)$/, (w) => `지금 일정: ${w}`, (w) => `当前安排：${w}`],
    [/^Already applied as (.+)$/, (w) => `${w}(으)로 이미 지원함`, (w) => `已以 ${w} 申请`],
    [/^Can't read (.+)$/, (h) => `${h}을(를) 읽을 수 없습니다`, (h) => `无法读取 ${h}`],
    [/^On (.+), click "Apply" first, then fill\.$/, (h) => `${h}에서 먼저 "지원"을 누른 뒤 입력하세요.`, (h) => `请先在 ${h} 点击"申请"，再进行填写。`],
    [/^Filled (\d+) fields? as (.+)$/, (n, w) => `${w}(으)로 ${n}개 항목 입력함`, (n, w) => `已以 ${w} 填写 ${n} 个字段`],
    [/^(.+) already logged this job\.$/, (w) => `${w}이(가) 이미 이 공고를 기록했습니다.`, (w) => `${w} 已记录过此职位。`],
    [/^Profile country is (.+), but this IP is in (.+)$/, (a, b) => `프로필 국가는 ${a}인데 이 IP는 ${b}에 있습니다`, (a, b) => `资料国家是 ${a}，但此 IP 位于 ${b}`],
    [/^until (\d\d?:\d\d)$/, (t) => `${t}까지`, (t) => `直到 ${t}`],
    [/^This key is from (.+), not (.+)\.$/, (a, b) => `이 키는 ${b}가 아니라 ${a} 키입니다.`, (a, b) => `此密钥属于 ${a}，不是 ${b}。`],
    [/^Use as (.+)$/, (a) => `${a}(으)로 사용`, (a) => `改为 ${a}`],
    [/^Detected a (.+) key\.$/, (a) => `${a} 키를 감지했습니다.`, (a) => `已识别为 ${a} 密钥。`],
    [/^Moved to (.+) - checking it\.\.\.$/, (a) => `${a}(으)로 옮겼습니다 - 확인 중...`, (a) => `已改为 ${a} - 正在检查...`],
    [/^(.+) · (Balanced|Best quality|Fast|Fastest)$/, (n, t) => `${n} · ${{ Balanced: '균형', 'Best quality': '최고 품질', Fast: '빠름', Fastest: '가장 빠름' }[t]}`, (n, t) => `${n} · ${{ Balanced: '均衡', 'Best quality': '质量最佳', Fast: '快速', Fastest: '最快' }[t]}`],
    [/^All (.+) models \((\d+)\)$/, (a, n) => `${a} 전체 모델 (${n})`, (a, n) => `${a} 全部模型（${n}）`],
    [/^Goal (\d+)$/, (n) => `목표 ${n}`, (n) => `目标 ${n}`],
    [/^to (\d\d?:\d\d)$/, (t) => `~ ${t}`, (t) => `至 ${t}`],
    [/^Skill match: (\d+) of (\d+) skills in the job description$/, (a, b) => `기술 일치: 공고의 기술 ${b}개 중 ${a}개`, (a, b) => `技能匹配：职位描述中 ${b} 项技能符合 ${a} 项`],
    [/^Not in (.+)'s profile$/, (w) => `${w}의 프로필에 없음`, (w) => `不在 ${w} 的资料中`],
    [/^AI: (\d+)\/(\d+) keys live(.*)$/, (a, b, r) => `AI: 키 ${b}개 중 ${a}개 작동${r.replace(/(\d+) dead/, '$1개 작동 안 함')}`, (a, b, r) => `AI：${a}/${b} 个密钥可用${r.replace(/(\d+) dead/, '$1 个不可用')}`],
    // ---- Added: sentences with numbers ----
    [/^(\d+) interviews? \/ offers? so far$/, (n) => `지금까지 면접/오퍼 ${n}건`, (n) => `目前已有 ${n} 个面试/录用`],
    [/^(\d+) positions?$/, (n) => `경력 ${n}개`, (n) => `${n} 段工作经历`],
    [/^(\d+) entr(?:y|ies)$/, (n) => `${n}개 항목`, (n) => `${n} 项`],
    [/^(\d+) skills?$/, (n) => `기술 ${n}개`, (n) => `${n} 项技能`],
    [/^(\d+) applications?$/, (n) => `지원 ${n}건`, (n) => `${n} 个申请`],
    [/^(\d+) of (\d+) applications?$/, (a, b) => `전체 ${b}건 중 ${a}건`, (a, b) => `共 ${b} 个，显示 ${a} 个`],
    [/^(\d+) remembered · questions JobBid couldn't answer are collected here$/, (n) => `${n}개 기억됨 · JobBid가 답하지 못한 질문이 여기에 모입니다`, (n) => `已记住 ${n} 个 · JobBid 无法回答的问题会收集在这里`],
    [/^(\d+) versions? · "Use on sites" picks one automatically$/, (n) => `${n}개 버전 · "사용할 사이트"에 따라 자동 선택`, (n) => `${n} 个版本 ·“用于的网站”会自动选择`],
    [/^(\d+) of (\d+) keys? live(?: · (\d+) dead)?$/, (a, b, d) => `키 ${b}개 중 ${a}개 작동${d ? ` · ${d}개 실패` : ''}`, (a, b, d) => `${b} 个密钥中 ${a} 个可用${d ? ` · ${d} 个失效` : ''}`],
    [/^AI: (\d+)\/(\d+) keys live(?: · (\d+) dead)?$/, (a, b, d) => `AI: 키 ${a}/${b}개 작동${d ? ` · ${d}개 실패` : ''}`, (a, b, d) => `AI：${a}/${b} 个密钥可用${d ? ` · ${d} 个失效` : ''}`],
    [/^(\d+) questions? needs? an answer$/, (n) => `답변이 필요한 질문 ${n}개`, (n) => `${n} 个问题需要回答`],
    [/^(\d+) to answer$/, (n) => `답변 필요 ${n}`, (n) => `待回答 ${n}`],
    [/^Add block on (Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/, (d) => `${({ Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' })[d]}요일에 시간대 추가`, (d) => `在${({ Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' })[d]}添加时间段`],
    [/^goal (\d+)$/, (n) => `목표 ${n}`, (n) => `目标 ${n}`],
    [/^Goal (\d+)$/, (n) => `목표 ${n}`, (n) => `目标 ${n}`],
    [/^Starts in (?:(\d+)h )?(\d+)m$/, (h, m) => `${h ? h + '시간 ' : ''}${m}분 후 시작`, (h, m) => `${h ? h + ' 小时 ' : ''}${m} 分钟后开始`],
    [/^Now · (?:(\d+)h )?(\d+)m left$/, (h, m) => `진행 중 · ${h ? h + '시간 ' : ''}${m}분 남음`, (h, m) => `进行中 · 剩余 ${h ? h + ' 小时 ' : ''}${m} 分钟`],
    [/^Now: (.+) until (\d{1,2}:\d{2})$/, (p, t) => `현재: ${p} (${t}까지)`, (p, t) => `当前：${p}（至 ${t}）`],
    [/^Next: (.+) at (\d{1,2}:\d{2})$/, (p, t) => `다음: ${p} (${t})`, (p, t) => `下一个：${p}（${t}）`],
    [/^Attach: (.+)$/, (f) => `첨부: ${f}`, (f) => `附加：${f}`],
    [/^Live · ([\d.]+)s reply · (used|checked) (.+)$/, (s, k, t) => `작동 · 응답 ${s}초 · ${t} ${k === 'used' ? '사용' : '확인'}`, (s, k, t) => `可用 · 响应 ${s} 秒 · ${t}${k === 'used' ? '使用' : '检查'}`],
    [/^Live · (used|checked) (.+)$/, (k, t) => `작동 · ${t} ${k === 'used' ? '사용' : '확인'}`, (k, t) => `可用 · ${t}${k === 'used' ? '使用' : '检查'}`],
    [/^Failed (.+?)(?: \(with a different model\))?: ([\s\S]+)$/, (t, e) => `실패 (${t}): ${e}`, (t, e) => `失败（${t}）：${e}`],
    [/^Add: (.+)\. More details means fewer fields left for you or the AI\.$/, (l) => `추가할 항목: ${l}. 정보가 많을수록 직접 채우거나 AI가 채울 항목이 줄어듭니다.`, (l) => `需补充：${l}。信息越完整，需要你或 AI 填写的字段就越少。`],
    [/^Remembered (\d+) answers? for (.+)$/, (n, p) => `${p}의 답변 ${n}개 기억함`, (n, p) => `已为 ${p} 记住 ${n} 个答案`],
    [/^Check this resume (with AI )?and fill the blanks in (.+)'s profile\?$/, (ai, p) => `이 이력서를 ${ai ? 'AI로 ' : ''}확인하고 ${p}의 프로필 빈칸을 채울까요?`, (ai, p) => `${ai ? '用 AI ' : ''}检查此简历并填写 ${p} 资料中的空白吗？`],
    [/^Fill (.+)'s blanks$/, (p) => `${p}의 빈칸 채우기`, (p) => `填写 ${p} 的空白`],
    [/^Found (\d+) blanks? this resume can fill\. Untick anything you don't want\.$/, (n) => `이 이력서로 채울 수 있는 빈칸 ${n}개를 찾았습니다. 원하지 않는 항목은 체크를 해제하세요.`, (n) => `找到 ${n} 个可由此简历填写的空白。取消勾选不需要的项。`],
    [/^Everything this resume contains is already in (.+)'s profile\.$/, (p) => `이 이력서의 내용은 이미 ${p}의 프로필에 모두 있습니다.`, (p) => `此简历的内容已全部在 ${p} 的资料中。`],
    [/^Filled (\d+) blanks? in (.+)'s profile from (.+)\.$/, (n, p, f) => `${f}에서 ${p}의 프로필 빈칸 ${n}개를 채웠습니다.`, (n, p, f) => `已根据 ${f} 填写 ${p} 资料中的 ${n} 个空白。`],
    [/^Skills \((\d+) new\)$/, (n) => `기술 (새 항목 ${n}개)`, (n) => `技能（新增 ${n} 项）`],
    [/^Posted (.+)$/, (t) => `게시: ${t}`, (t) => `发布于：${t}`],
    [/^Visa sponsorship: (.+)$/, (v) => `비자 후원: ${({ Yes: '예', No: '아니요' })[v] || v}`, (v) => `签证担保：${({ Yes: '是', No: '否' })[v] || v}`],
    [/^Apply by (.+)$/, (d) => `${d}까지 지원`, (d) => `截止日期：${d}`],
    [/^Filled (\d+) blanks? automatically\. Check the typical screening answers - change any that aren't true\.$/, (n) => `빈칸 ${n}개를 자동으로 채웠습니다. 일반적인 사전 질문 답변을 확인하고 사실과 다른 항목은 바꾸세요.`, (n) => `已自动填写 ${n} 个空白。请检查常见筛选问题的答案，不符合实际的请修改。`],
    [/^(.+) \(typical\)$/, (l) => `${t(l)} (일반 답변)`, (l) => `${t(l)}（常见答案）`],
    [/^Undone - (.+)'s profile is back as it was\.$/, (p) => `되돌렸습니다 - ${p}의 프로필이 이전 상태로 돌아갔습니다.`, (p) => `已撤销 - ${p} 的资料已恢复原样。`],
    [/^Check keys every 2 minutes \(doesn't use AI quota\)(?: · last check (.+))?$/, (t) => `2분마다 키 확인 (AI 사용량 소모 없음)${t ? ` · 마지막 확인 ${t}` : ''}`, (t) => `每 2 分钟检查密钥（不消耗 AI 额度）${t ? ` · 上次检查 ${t}` : ''}`],
    [/^Live · ([\d.]+)s reply · auto-checked (.+)$/, (s, t) => `작동 · 응답 ${s}초 · ${t} 자동 확인`, (s, t) => `可用 · 响应 ${s} 秒 · ${t}自动检查`],
    [/^(.+) - (.+) applied on (.+?)\.( Also: .+\.)?$/, (j, p, d, o) => `${j} - ${p}님이 ${d}에 지원했습니다.${o ? ' 다른 프로필: ' + o.replace(/^ Also: |\.$/g, '') + '.' : ''}`, (j, p, d, o) => `${j} - ${p} 已于 ${d} 申请。${o ? '其他：' + o.replace(/^ Also: |\.$/g, '') + '。' : ''}`],
    [/^Saved (\d+) questions?$/, (n) => `질문 ${n}개 저장됨`, (n) => `已保存 ${n} 个问题`],
    [/^(\d+) duplicate files? \(same name and size\)\.$/, (n) => `중복 파일 ${n}개 (같은 이름과 크기).`, (n) => `${n} 个重复文件（名称和大小相同）。`],
    [/^(.+) is already in this profile$/, (f) => `${f}은(는) 이미 이 프로필에 있습니다`, (f) => `${f} 已在此资料中`],
    [/^Open JobBid · (\d+) required fields empty$/, (n) => `JobBid 열기 · 필수 항목 ${n}개 비어 있음`, (n) => `打开 JobBid · ${n} 个必填项为空`],
    [/^(\d+) questions? to answer$/, (n) => `답할 질문 ${n}개`, (n) => `${n} 个问题待回答`],
    [/^(\d+) duplicate resumes?$/, (n) => `중복 이력서 ${n}개`, (n) => `${n} 个重复简历`],
    [/^Profile (\d+)% complete$/, (n) => `프로필 ${n}% 완성`, (n) => `资料完成 ${n}%`],
    [/^(\d+) AI keys? (is|are) dead$/, (n) => `AI 키 ${n}개가 작동하지 않음`, (n) => `${n} 个 AI 密钥失效`],
    [/^\+(\d+) more$/, (n) => `+${n}개 더`, (n) => `还有 ${n} 项`],
    [/^(.+) applied before$/, (p) => `${p}이(가) 이전에 지원함`, (p) => `${p} 之前已申请`],
    [/^(\d+) applications$/, (n) => `지원 ${n}건`, (n) => `${n} 次申请`],
    [/^Submitting in (\d+)s$/, (n) => `${n}초 후 제출`, (n) => `${n} 秒后提交`],
    [/^All required fields are filled\. JobBid will press "(.+)"\.$/, (b) => `필수 항목이 모두 채워졌습니다. JobBid가 "${b}" 버튼을 누릅니다.`, (b) => `必填项已全部填写。JobBid 将点击“${b}”。`],
    [/^(.+) already applied to this job\.$/, (p) => `${p}은(는) 이미 이 공고에 지원했습니다.`, (p) => `${p} 已申请过此职位。`],
    [/^(\d+) fields need you - go to next$/, (n) => `직접 입력할 항목 ${n}개 - 다음으로 이동`, (n) => `${n} 个字段需要您填写 - 前往下一个`],
    [/^Answer them once in (.+)'s Saved answers \(dashboard\) and they fill automatically next time\.$/, (p) => `대시보드에서 ${p}의 저장된 답변에 한 번만 답하면 다음부터 자동으로 채워집니다.`, (p) => `在控制台 ${p} 的已保存答案中回答一次，下次就会自动填写。`],
  ];

  // Phrases inside longer text (e.g. "Acme · 2h ago", "1 / 20 applied"), replaced after exact/pattern lookup fails.
  const F = [
    [/\bjust now\b/g, () => '방금', () => '刚刚'],
    [/\b(\d+)m ago\b/g, (n) => `${n}분 전`, (n) => `${n} 分钟前`],
    [/\b(\d+)h ago\b/g, (n) => `${n}시간 전`, (n) => `${n} 小时前`],
    [/\b(\d+)d ago\b/g, (n) => `${n}일 전`, (n) => `${n} 天前`],
    [/(\d+) applied\b/g, (n) => `${n} 지원`, (n) => `${n} 已申请`],
    [/\b(\d+) fields?\b/g, (n) => `항목 ${n}개`, (n) => `${n} 个字段`],
    [/\b(\d+) required\b/g, (n) => `필수 ${n}개`, (n) => `${n} 个必填`],
    [/\bresume upload\b/g, () => '이력서 업로드', () => '简历上传'],
    [/\bReview everything, then submit\./g, () => '모두 확인한 뒤 제출하세요.', () => '请检查所有内容后再提交。'],
    [/\b(\d+)% complete\b/g, (n) => `${n}% 완료`, (n) => `已完成 ${n}%`],
    [/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g,
      (m, y) => `${y}년 ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m) + 1}월`,
      (m, y) => `${y}年${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m) + 1}月`],
    [/\bPresent\b/g, () => '현재', () => '至今'],
    [/^Applications per day:/g, () => '일별 지원 수:', () => '每日申请数：'],
    [/: live$/g, () => ': 작동', () => '：可用'],
    [/: not checked$/g, () => ': 확인 안 됨', () => '：未检查'],
    [/: dead - /g, () => ': 실패 - ', () => '：失效 - '],
    [/\b(\d+)\+? (minute|hour|day|week|month)s? ago\b/g,
      (n, u) => `${n}${({ minute: '분', hour: '시간', day: '일', week: '주', month: '개월' })[u]} 전`,
      (n, u) => `${n} ${({ minute: '分钟', hour: '小时', day: '天', week: '周', month: '个月' })[u]}前`],
    [/\((today|yesterday)\)/g, (w) => (w === 'today' ? '(오늘)' : '(어제)'), (w) => (w === 'today' ? '（今天）' : '（昨天）')],
    [/\((\d+) days ago\)/g, (n) => `(${n}일 전)`, (n) => `（${n} 天前）`],
  ];

  let lang = 'en';
  const isExtPage = location.protocol === 'chrome-extension:';
  try { if (isExtPage) lang = localStorage.getItem('jbLang') || 'en'; } catch {}

  function t(src) {
    if (lang === 'en' || !src) return src;
    const whole = tOne(src);
    // Multi-line tooltips: if the whole text has no translation, translate line by line.
    if (whole !== src || !src.trim().includes('\n')) return whole;
    return src.split('\n').map(tOne).join('\n');
  }

  function frag(text, i) {
    for (const [re, ko, zh] of F) text = text.replace(re, (...a) => (i ? zh : ko)(...a.slice(1, -2)));
    return text;
  }

  function tOne(src) {
    const i = lang === 'ko' ? 0 : 1;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(src);
    // Source text may contain line breaks/indentation from templates; match on single spaces.
    const core = m[2].replace(/\s+/g, ' ');
    if (!/[A-Za-z]/.test(core)) return src;
    if (T[core]) return m[1] + T[core][i] + m[3];
    for (const [re, ko, zh] of P) {
      const r = re.exec(core);
      // Parts captured by a sentence pattern (e.g. "2m ago") still get the fragment translations.
      if (r) return m[1] + frag((i ? zh : ko)(...r.slice(1).map((g) => g ?? '')), i) + m[3];
    }
    const out = frag(core, i);
    // Nothing translated: keep the original text exactly (including its line breaks).
    return out === core ? src : m[1] + out + m[3];
  }

  // Remember each node's English source so switching language (or back to English) is lossless.
  const textSrc = new WeakMap();
  const attrSrc = new WeakMap();
  const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
  const SKIP = 'script, style, textarea, code, [translate="no"], .notranslate';
  // Attributes (e.g. a textarea's placeholder) are still translated on these elements.
  const SKIP_ATTR = 'script, style, code, [translate="no"], .notranslate';

  function doText(n) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const rec = textSrc.get(n);
    const src = rec && n.data === rec.out ? rec.src : n.data;
    const out = t(src);
    textSrc.set(n, { src, out });
    if (n.data !== out) n.data = out;
  }

  function doAttr(el, a) {
    if (!el.hasAttribute(a) || el.closest(SKIP_ATTR)) return;
    const recs = attrSrc.get(el) || {};
    const cur = el.getAttribute(a);
    const src = recs[a] && cur === recs[a].out ? recs[a].src : cur;
    const out = t(src);
    recs[a] = { src, out };
    attrSrc.set(el, recs);
    if (cur !== out) el.setAttribute(a, out);
  }

  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) doText(w.currentNode);
    if (node.nodeType === 1) ATTRS.forEach((a) => doAttr(node, a));
    node.querySelectorAll?.('[title], [placeholder], [aria-label], optgroup[label]').forEach((el) => ATTRS.forEach((a) => doAttr(el, a)));
  }

  function markSegs(root) {
    root.querySelectorAll('[data-lang-opt]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.langOpt === lang)));
    root.querySelectorAll('select[data-lang-select]').forEach((s) => (s.value = lang));
  }

  const roots = [];
  function observe(root) {
    if (roots.includes(root)) return;
    roots.push(root);
    walk(root);
    markSegs(root);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttr(m.target, m.attributeName);
        else m.addedNodes.forEach(walk);
      }
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // Any [data-lang-opt] button or select[data-lang-select] inside the root switches language.
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-lang-opt]');
      if (b) { e.preventDefault(); save(b.dataset.langOpt); }
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches?.('select[data-lang-select]')) save(e.target.value);
    });
  }

  function apply(l) {
    lang = LANGS[l] ? l : 'en';
    try { if (isExtPage) localStorage.setItem('jbLang', lang); } catch {}
    if (roots.includes(document)) document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    roots.forEach((r) => { walk(r); markSegs(r); });
  }

  async function save(l) {
    apply(l);
    try {
      const { settings = {} } = await chrome.storage.local.get('settings');
      settings.lang = lang;
      await chrome.storage.local.set({ settings });
    } catch {
      // Extension was reloaded under this page; the language still switched here.
    }
  }

  try {
    chrome.storage.local.get('settings').then(({ settings }) => { if ((settings?.lang || 'en') !== lang) apply(settings?.lang); }).catch(() => {});
  } catch {}
  // chrome.storage is gone in pages left over from before an extension reload: skip quietly.
  try {
    chrome.storage?.onChanged?.addListener((c) => {
      const l = c.settings?.newValue?.lang || 'en';
      if (c.settings && l !== lang) apply(l);
    });
  } catch {}

  self.jbI18n = { LANGS, SHORT, t, observe, setLang: save, get lang() { return lang; }, get locale() { return { ko: 'ko-KR', zh: 'zh-CN' }[lang]; } };

  // Extension pages translate the whole document; content scripts call observe() on their own shadow roots.
  if (isExtPage) {
    if (document.body) observe(document);
    else document.addEventListener('DOMContentLoaded', () => observe(document));
  }
})();
