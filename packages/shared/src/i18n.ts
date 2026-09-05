import type { Locale } from './domain';

export const AI_PROVIDER_PRODUCT_OPTIONS = [
  { value: 'codex_subscription', label: 'OpenAI Codex Subscription' },
  { value: 'grok_subscription', label: 'Grok Subscription' },
  { value: 'openai_compatible_api', label: 'OpenAI-Compatible API' }
] as const;

export type AiProviderProduct = typeof AI_PROVIDER_PRODUCT_OPTIONS[number]['value'];

export function aiProviderProductFields(product: AiProviderProduct) {
  const isHttp = product === 'openai_compatible_api';
  return {
    httpCredentials: isHttp,
    modelConfiguration: isHttp,
    roleSelection: isHttp,
    activation: isHttp
  } as const;
}

export const DEFAULT_LOCALE: Locale = 'ko';

export type CopyKey =
  | 'appName'
  | 'navHome'
  | 'navImports'
  | 'homeTitle'
  | 'homeDescription'
  | 'importsTitle'
  | 'importsDescription'
  | 'newImport'
  | 'uploadTitle'
  | 'uploadHelp'
  | 'startImport'
  | 'importQueued'
  | 'importProcessing'
  | 'importCompleted'
  | 'importFailed'
  | 'candidateTitle'
  | 'keywordLabel'
  | 'scoreLabel'
  | 'decisionReasonLabel'
  | 'languageKorean'
  | 'languageEnglish'
  | 'totalImports'
  | 'totalCandidates'
  | 'acceptedLabel'
  | 'rejectedLabel'
  | 'uniqueKeywords'
  | 'duplicateKeywords'
  | 'recentCandidates'
  | 'recentImports'
  | 'noImports'
  | 'noCandidates'
  | 'fileCount'
  | 'rowCount'
  | 'createdAt'
  | 'statusLabel'
  | 'selectedFiles'
  | 'uploadingFiles'
  | 'uploadSuccess'
  | 'uploadError'
  | 'returnToImports'
  | 'privacyNote'
  | 'viewAllImports'
  | 'skipToContent'
  | 'technicalDetails'
  | 'showcaseTitle'
  | 'dataUnavailable'
  | 'showcaseActions'
  | 'showcaseStatus'
  | 'showcaseMetrics'
  | 'showcaseStates'
  | 'uploadTooMany'
  | 'uploadTooLarge'
  | 'uploadInvalidFile'
  | 'navAiSettings'
  | 'navResearchGroup'
  | 'aiSettingsTitle'
  | 'aiSettingsDescription'
  | 'providerName'
  | 'billingType'
  | 'providerKind'
  | 'providerProduct'
  | 'baseUrl'
  | 'apiKey'
  | 'modelId'
  | 'executable'
  | 'fixedArgs'
  | 'networkScope'
  | 'openRouterZaiOnly'
  | 'commandProfile'
  | 'saveProvider'
  | 'savingProvider'
  | 'newOpenAiProvider'
  | 'savedProviders'
  | 'editProvider'
  | 'testConnection'
  | 'testingConnection'
  | 'disableProvider'
  | 'subscriptionLabel'
  | 'subscriptionRole'
  | 'subscriptionModel'
  | 'subscriptionStatus'
  | 'lastProbe'
  | 'setupRequired'
  | 'authorizationExpired'
  | 'probePending'
  | 'temporarilyUnavailable'
  | 'providerDisabled'
  | 'operatorAuthorizationGuidance'
  | 'httpTestCostWarning'
  | 'providerSaved'
  | 'secretStored'
  | 'connectionReady'
  | 'connectionUnavailable'
  | 'connectionResponseInvalid'
  | 'connectionRequestRejected'
  | 'noProviders'
  | 'roleAssignments'
  | 'providerEnabled'
  | 'providerPriority'
  | 'modelEnabled'
  | 'modelPriority'
  | 'adminLoginTitle'
  | 'adminPassword'
  | 'adminTotp'
  | 'adminLogin'
  | 'adminLogout'
  | 'invalidLogin'
  | 'researchNow'
  | 'researchNowQueued'
  | 'researchNowError'
  | 'navDashboard'
  | 'competitionLabel'
  | 'navCandidates'
  | 'navRuns'
  | 'navSettings'
  | 'candidatesTitle'
  | 'runsTitle'
  | 'settingsTitle'
  | 'settingsLocale'
  | 'settingsTimezone'
  | 'settingsAllocation'
  | 'settingsManualReserve'
  | 'settingsReadOnly'
  | 'queuedLabel'
  | 'runningLabel'
  | 'waitingLabel'
  | 'completedLabel'
  | 'apiBudgetLabel'
  | 'demandLabel'
  | 'marginLabel'
  | 'differentiationLabel'
  | 'noRuns'
  | 'waitingBudgetLabel'
  | 'needsAttentionLabel'
  | 'providerActive'
  | 'reserveLabel'
  | 'evidenceLabel'
  | 'noEvidence'
  | 'runPlanningLabel'
  | 'runFanoutLabel'
  | 'failedLabel'
  | 'sourceScheduled'
  | 'sourceManual'
  | 'stateDiscovered'
  | 'stateRuleFilter'
  | 'stateAiScreening'
  | 'stateReadyForApiValidation'
  | 'stateWaitingForApiBudget'
  | 'stateApiValidationRunning'
  | 'stateDeepResearch'
  | 'stateStrong'
  | 'stateWatch'
  | 'stateReject'
  | 'stateNeedsReview'
  | 'stateWaitingForAiCapacity'
  | 'stateNeedsAttention'
  | 'researchNowOverride'
  | 'researchNowOverrideConfirm'
  | 'briefingBasis'
  | 'briefingUnavailable'
  | 'briefingNeedsReview'
  | 'briefingInProgress'
  | 'briefingRecorded'
  | 'queueTitle'
  | 'queueOrderNote'
  | 'openCandidate'
  | 'noReasonRecorded'
  | 'queueEmptyHint'
  | 'pulseTitle'
  | 'pulseUnitNote'
  | 'pulseStageImports'
  | 'pulseStageDiscovery'
  | 'pulseStageValidation'
  | 'pulseStageDecided'
  | 'pulseNeedsReview'
  | 'pulseEmpty'
  | 'statusUnavailable'
  | 'jobsTitle'
  | 'jobsZero'
  | 'budgetNoRecord'
  | 'budgetZero'
  | 'budgetBlocked'
  | 'budgetRemainingLabel'
  | 'researchNowPending'
  | 'providerGroupIdentity'
  | 'providerGroupCapability'
  | 'providerGroupRouting'
  | 'providerGroupConnection'
  | 'briefingBudgetWait'
  | 'briefingCapacityWait'
  | 'briefingDecided'
  | 'focusTitle'
  | 'focusOrderNote'
  | 'groupMore'
  | 'groupAllCandidates'
  | 'confidenceNotice'
  | 'bottleneckTitle'
  | 'bottleneckNone'
  | 'bottleneckFlowing'
  | 'pipelinePathLabel'
  | 'opsTitle'
  | 'fleetTitle'
  | 'fleetEnabled'
  | 'fleetAttention'
  | 'fleetTotal'
  | 'fleetRoles'
  | 'addProvider'
  | 'testSectionTitle'
  | 'workspaceNewHint'
  | 'navPhaseJudge'
  | 'navPhaseOperate'
  | 'navPhaseAi'
  | 'detailVerdictQuestion'
  | 'detailSignalsTitle'
  | 'detailGapTitle'
  | 'detailNextTitle'
  | 'detailNoScore'
  | 'candidatesJudgeNote'
  | 'candidatesColJudgment'
  | 'candidatesColConfidence'
  | 'candidatesNextAction'
  | 'runsProvenanceNote'
  | 'importsProvenanceNote'
  | 'importsFreshness'
  | 'decisionCallTitle'
  | 'decisionWhy'
  | 'decisionGap'
  | 'decisionGapNone'
  | 'decisionAct'
  | 'decisionEmptyTitle'
  | 'decisionEmptyBody'
  | 'researchObjectLabel'
  | 'recordsInGroup'
  | 'groupShowRecords'
  | 'groupHideRecords'
  | 'groupStatesSummary'
  | 'scoreNotVerdict'
  | 'preVerificationLabel'
  | 'preVerificationDetail'
  | 'groupNextActionOpen'
  | 'importsRecordSummary'
  | 'importsSameTimestampNote'
  | 'importIdLabel'
  | 'importRecordOrdinal'
  | 'signalsNotComputed'
  | 'importTimestampNote'
  | 'navCurrentLocation';
type CopyDictionary = Record<CopyKey, string>;

export const COPY = {
  ko: {
    appName: 'Amazon Research Agent',
    navHome: '홈',
    navImports: '가져오기',
    homeTitle: 'Kitchen & Dining 기회 연구',
    homeDescription: '저비용 발견과 검증 가능한 결정 기록을 한곳에서 관리합니다.',
    importsTitle: 'Opportunity Finder 가져오기',
    importsDescription: 'Jungle Scout Opportunity Finder CSV를 병합하고 API 호출 없이 1차 평가합니다.',
    newImport: '새 가져오기',
    uploadTitle: 'CSV 파일 업로드',
    uploadHelp: '최대 20개, 파일당 10 MB 이하의 CSV 파일을 선택하세요.',
    startImport: '가져오기 시작',
    importQueued: '처리 대기',
    importProcessing: '처리 중',
    importCompleted: '완료',
    importFailed: '실패',
    candidateTitle: '후보',
    keywordLabel: '키워드',
    scoreLabel: 'Preliminary Score',
    decisionReasonLabel: '결정 사유',
    languageKorean: '한국어',
    languageEnglish: 'English',
    totalImports: '전체 가져오기',
    totalCandidates: '전체 후보',
    acceptedLabel: 'AI Screening 대상',
    rejectedLabel: 'Reject',
    uniqueKeywords: '고유 키워드',
    duplicateKeywords: '중복 키워드',
    recentCandidates: '최근 후보',
    recentImports: '최근 가져오기',
    noImports: '아직 가져온 파일이 없습니다.',
    noCandidates: '아직 평가된 후보가 없습니다.',
    fileCount: '파일',
    rowCount: '원본 행',
    createdAt: '생성 시각',
    statusLabel: '상태',
    selectedFiles: '선택한 파일',
    uploadingFiles: '파일을 업로드하고 작업을 등록합니다…',
    uploadSuccess: '가져오기가 등록되었습니다. Worker가 백그라운드에서 처리합니다.',
    uploadError: '가져오기를 등록하지 못했습니다. 파일을 확인하고 다시 시도하세요.',
    returnToImports: '가져오기 목록으로 돌아가기',
    importIdLabel: 'Import run ID',
    privacyNote: '파일은 private Storage에 저장하며 서버 자격 증명은 브라우저에 노출하지 않습니다.',
    viewAllImports: '모든 가져오기 보기',
    skipToContent: '본문으로 건너뛰기',
    technicalDetails: '기술 세부 정보',
    showcaseTitle: 'UI primitive 검증',
    dataUnavailable: '데이터베이스 연결이 아직 설정되지 않아 빈 대시보드를 표시합니다.',
    showcaseActions: '동작',
    showcaseStatus: '상태',
    showcaseMetrics: '지표',
    showcaseStates: '폼 / 빈 상태 / 오류',
    uploadTooMany: 'CSV 파일은 최대 20개까지만 선택하세요.',
    uploadTooLarge: '각 CSV 파일은 10 MB 이하여야 합니다.',
    uploadInvalidFile: '비어 있지 않은 CSV 파일만 선택할 수 있습니다.',
    navAiSettings: 'AI 설정',
    navResearchGroup: '리서치 운영',
    aiSettingsTitle: 'AI Provider 설정',
    aiSettingsDescription: '구독 Provider와 OpenAI-compatible API를 제품 단위로 안전하게 관리합니다.',
    providerName: 'Provider 이름',
    billingType: '결제 방식',
    providerKind: 'Provider 종류',
    providerProduct: 'AI 제품',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    modelId: 'Model ID',
    executable: 'Command executable',
    fixedArgs: 'Fixed arguments (JSON array)',
    networkScope: 'Network scope',
    commandProfile: 'Command profile',
    openRouterZaiOnly: 'OpenRouter에서 Z.ai만 사용 (fallback 없음)',
    saveProvider: '저장',
    savingProvider: '저장 중…',
    newOpenAiProvider: '새 OpenAI 호환 Provider',
    savedProviders: '저장된 Provider',
    editProvider: '수정',
    testConnection: '연결 테스트',
    testingConnection: '테스트 중…',
    disableProvider: '비활성화',
    subscriptionLabel: 'Subscription',
    subscriptionRole: '고정 역할',
    subscriptionModel: '모델',
    subscriptionStatus: '권한 상태',
    lastProbe: '마지막 상태 확인',
    setupRequired: '설정 필요',
    authorizationExpired: '재인증 필요',
    probePending: '상태 확인 대기',
    temporarilyUnavailable: '일시적으로 사용할 수 없음',
    providerDisabled: '비활성화됨',
    operatorAuthorizationGuidance: '운영 서버에서 승인된 절차로 인증 또는 재인증하세요. 브라우저에서는 계정 인증이나 활성화를 수행하지 않습니다.',
    httpTestCostWarning: '연결 테스트는 실제 completion을 실행할 수 있으며 API quota 또는 비용을 사용할 수 있습니다.',
    providerSaved: 'Provider 설정을 저장했습니다.',
    secretStored: '저장된 key',
    connectionReady: 'Provider 연결 가능',
    connectionUnavailable: 'Provider 연결 불가',
    connectionResponseInvalid: 'Provider 응답 형식 확인 필요',
    connectionRequestRejected: 'Provider가 연결 요청을 거부함',
    noProviders: '저장된 provider가 없습니다.',
    roleAssignments: 'Role assignments',
    providerEnabled: 'Provider enabled',
    providerPriority: 'Provider priority',
    modelEnabled: 'Model enabled',
    modelPriority: 'Model priority',
    adminLoginTitle: '관리자 로그인',
    adminPassword: '관리자 비밀번호',
    adminTotp: '인증 앱 코드 (설정한 경우)',
    adminLogin: '로그인',
    adminLogout: '로그아웃',
    invalidLogin: '로그인 정보가 올바르지 않습니다.',
    researchNow: '지금 리서치',
    researchNowQueued: '대기열에 추가됨',
    researchNowError: '리서치를 대기열에 넣지 못했습니다.',
    navDashboard: '대시보드',
    competitionLabel: '경쟁도',
    navCandidates: '후보',
    settingsTitle: '리서치 설정',
    settingsLocale: '언어',
    settingsTimezone: '시간대',
    settingsAllocation: '후보군별 API 배분',
    settingsManualReserve: '수동 예약분',
    settingsReadOnly: '이 화면은 읽기 전용입니다. 운영 설정은 승인된 서버 절차로 관리합니다.',
    navRuns: '실행',
    navSettings: '설정',
    candidatesTitle: '후보 목록',
    runsTitle: '리서치 실행',
    queuedLabel: '대기',
    runningLabel: '실행 중',
    waitingLabel: '대기 중',
    completedLabel: '완료',
    apiBudgetLabel: 'API 예산',
    demandLabel: '수요',
    marginLabel: '마진',
    differentiationLabel: '차별화',
    noRuns: '아직 리서치 실행이 없습니다.',
    waitingBudgetLabel: 'API 예산 대기',
    needsAttentionLabel: '확인 필요',
    providerActive: '활성',
    reserveLabel: '예약분',
    evidenceLabel: '수집 근거',
    noEvidence: '아직 수집된 근거가 없습니다.',
    runPlanningLabel: '계획 중',
    runFanoutLabel: '작업 분배 중',
    failedLabel: '실패',
    sourceScheduled: '예약 실행',
    sourceManual: '수동 실행',
    stateDiscovered: '발견됨',
    stateRuleFilter: '규칙 필터',
    stateAiScreening: 'AI 선별',
    stateReadyForApiValidation: 'API 검증 준비',
    stateWaitingForApiBudget: 'API 예산 대기',
    stateApiValidationRunning: 'API 검증 중',
    stateDeepResearch: '심층 리서치',
    stateStrong: '강한 후보',
    stateWatch: '관찰',
    stateReject: '제외',
    stateNeedsReview: '검토 필요',
    stateWaitingForAiCapacity: 'AI 용량 대기',
    stateNeedsAttention: '확인 필요',
    researchNowOverride: '예약 예산 사용',
    researchNowOverrideConfirm: '예약 API 예산을 사용해서 지금 리서치를 실행할까요?',
    briefingBasis: '화면 조회 시각 (UTC)',
    briefingUnavailable: '연구 현황을 표시할 수 없습니다.',
    briefingNeedsReview: '검토가 필요한 후보가 {count}개 있습니다.',
    briefingInProgress: '진행 중인 후보가 {count}개 있습니다.',
    briefingRecorded: '기록된 후보가 총 {count}개 있습니다.',
    queueTitle: '결정 대기열',
    queueOrderNote: '확인이 필요한 상태를 먼저 보여 주고, 이어서 preliminary score가 높은 순으로 정렬합니다.',
    openCandidate: '후보 열기',
    noReasonRecorded: '기록된 근거가 없습니다.',
    queueEmptyHint: 'CSV를 가져오면 Opportunity Finder 키워드가 후보로 등록됩니다.',
    pulseTitle: '파이프라인 현황',
    pulseUnitNote: '가져오기는 실행 건수이고, 이후 단계는 후보 수입니다.',
    pulseStageImports: '가져오기',
    pulseStageDiscovery: '발견',
    pulseStageValidation: '검증·준비',
    pulseStageDecided: '결정 완료',
    pulseNeedsReview: '검토·확인 필요',
    pulseEmpty: '파이프라인이 비어 있습니다. CSV를 가져오면 후보가 만들어집니다.',
    statusUnavailable: '상태를 확인할 수 없습니다.',
    jobsTitle: '작업 대기열',
    jobsZero: '대기 중인 작업이 없습니다.',
    budgetNoRecord: '오늘 예산 기록이 없습니다.',
    budgetZero: '오늘 사용 가능한 API 예산이 0입니다.',
    budgetBlocked: '예산이 소진되어 후보 {count}개가 대기 중입니다.',
    budgetRemainingLabel: '잔여',
    researchNowPending: '대기열에 추가하는 중…',
    providerGroupIdentity: 'Provider 식별',
    providerGroupCapability: '역할과 모델',
    providerGroupRouting: '라우팅과 우선순위',
    providerGroupConnection: '보안 연결',
    briefingBudgetWait: 'API 예산을 기다리는 후보가 {count}개 있습니다.',
    briefingCapacityWait: 'AI 용량을 기다리는 후보가 {count}개 있습니다.',
    briefingDecided: '결정이 완료된 후보가 {count}개 있습니다.',
    focusTitle: '지금 검토할 묶음',
    focusOrderNote: '확인 필요와 대기 상태를 먼저 묶고, 각 묶음 안에서는 preliminary score 순으로 정렬합니다.',
    groupMore: '같은 상태의 후보 {count}개 더 보기',
    groupAllCandidates: '이 상태 전체 {count}개는 후보 목록에서 보기',
    confidenceNotice: '이 묶음의 후보에는 아직 기록된 근거가 없습니다.',
    bottleneckTitle: '파이프라인 병목',
    bottleneckNone: '막힌 단계가 기록되어 있지 않습니다.',
    bottleneckFlowing: '막힘 없이 진행 중인 후보 {count}개',
    pipelinePathLabel: '단계별 후보 수',
    opsTitle: '운영 현황',
    fleetTitle: '현재 Fleet 상태',
    fleetEnabled: '활성',
    fleetAttention: '주의 필요',
    fleetTotal: '등록',
    fleetRoles: '역할',
    addProvider: '새 provider 추가',
    testSectionTitle: '연결 테스트 결과',
    workspaceNewHint: 'Provider를 저장하면 연결 테스트를 사용할 수 있습니다.',
    navPhaseJudge: '판단',
    navPhaseOperate: '실행·운영',
    navPhaseAi: 'AI 운영',
    detailVerdictQuestion: '이 기회를 진행할 근거가 충분한가?',
    detailSignalsTitle: '핵심 신호',
    detailGapTitle: '아직 부족한 근거',
    detailNextTitle: '다음 검증',
    detailNoScore: '점수가 아직 계산되지 않았습니다. 근거 수집이 먼저입니다.',
    candidatesJudgeNote: '행마다 판단 단계, 근거 상태, 다음 조치가 함께 보입니다. 위에서부터 비교해 결정하세요.',
    candidatesColJudgment: '판단',
    candidatesColConfidence: '근거',
    candidatesNextAction: '다음',
    runsProvenanceNote: '각 실행은 후보 판단에 쓰인 데이터가 언제, 어디서 만들어졌는지 보여 줍니다.',
    importsProvenanceNote: '가져오기는 후보 데이터의 원천입니다. 최근 항목일수록 판단 근거가 신선합니다.',
    importsFreshness: '데이터 기준',
    decisionCallTitle: '오늘의 판단',
    decisionWhy: '근거',
    decisionGap: '확인되지 않은 것',
    decisionGapNone: '기록된 근거만으로 판단 가능한 상태입니다.',
    decisionAct: '다음 행동',
    decisionEmptyTitle: '아직 판단할 후보가 없습니다.',
    decisionEmptyBody: 'CSV를 가져오면 Opportunity Finder 키워드가 후보로 등록되고 첫 판단이 만들어집니다.',
    researchObjectLabel: '연구 대상',
    recordsInGroup: '레코드 {count}개',
    groupShowRecords: '같은 키워드의 레코드 {count}개 보기',
    groupHideRecords: '레코드 접기',
    groupStatesSummary: '단계: {states}',
    scoreNotVerdict: '점수는 초기 스크리닝 값이며 결정이 아닙니다.',
    preVerificationLabel: '검증 전',
    preVerificationDetail: '수집된 근거가 없어 아직 판단할 수 없습니다.',
    groupNextActionOpen: '레코드를 열어 검토',
    importsRecordSummary: '파일 {files}개 · 원본 행 {rows}개 · 고유 키워드 {keywords}개',
    importsSameTimestampNote: '아래 항목들은 서로 다른 가져오기 기록입니다.',
    importRecordOrdinal: '기록 {ordinal}',
    signalsNotComputed: '미계산',
    importTimestampNote: '동일 시각에 등록된 별도 import 기록입니다. 기록 번호는 목록 순서이며 원본 식별자가 아닙니다.',
    navCurrentLocation: '현재 위치: {page}'
  },
  en: {
    appName: 'Amazon Research Agent',
    navHome: 'Home',
    navImports: 'Imports',
    homeTitle: 'Kitchen & Dining Opportunity Research',
    homeDescription: 'Manage low-cost discovery and auditable decisions in one place.',
    importsTitle: 'Opportunity Finder Imports',
    importsDescription: 'Merge Jungle Scout Opportunity Finder CSV files and evaluate them without API calls.',
    newImport: 'New import',
    uploadTitle: 'Upload CSV files',
    uploadHelp: 'Choose up to 20 CSV files, each no larger than 10 MB.',
    startImport: 'Start import',
    importQueued: 'Queued',
    importProcessing: 'Processing',
    importCompleted: 'Completed',
    importFailed: 'Failed',
    candidateTitle: 'Candidates',
    keywordLabel: 'Keyword',
    scoreLabel: 'Preliminary Score',
    decisionReasonLabel: 'Decision reason',
    languageKorean: '한국어',
    languageEnglish: 'English',
    totalImports: 'Total imports',
    totalCandidates: 'Total candidates',
    acceptedLabel: 'Accepted for AI Screening',
    rejectedLabel: 'Reject',
    uniqueKeywords: 'Unique keywords',
    duplicateKeywords: 'Duplicate keywords',
    recentCandidates: 'Recent candidates',
    recentImports: 'Recent imports',
    noImports: 'No files have been imported yet.',
    noCandidates: 'No candidates have been evaluated yet.',
    fileCount: 'Files',
    rowCount: 'Raw rows',
    createdAt: 'Created',
    statusLabel: 'Status',
    selectedFiles: 'Selected files',
    uploadingFiles: 'Securely uploading files and enqueueing the job…',
    uploadSuccess: 'Import queued. The worker will process it in the background.',
    uploadError: 'The import could not be queued. Check the files and try again.',
    returnToImports: 'Return to imports',
    importIdLabel: 'Import run ID',
    privacyNote: 'Files are stored in private Storage; server credentials are never exposed to the browser.',
    viewAllImports: 'View all imports',
    skipToContent: 'Skip to content',
    technicalDetails: 'Technical details',
    showcaseTitle: 'UI primitive verification',
    dataUnavailable: 'The database connection is not configured yet, so the dashboard is shown empty.',
    showcaseActions: 'Actions',
    showcaseStatus: 'Status',
    showcaseMetrics: 'Metrics',
    showcaseStates: 'Form / empty / error',
    uploadTooMany: 'Choose no more than 20 CSV files.',
    uploadTooLarge: 'Each CSV file must be no larger than 10 MB.',
    uploadInvalidFile: 'Choose non-empty CSV files only.',
    navAiSettings: 'AI settings',
    navResearchGroup: 'Research operations',
    aiSettingsTitle: 'AI provider settings',
    aiSettingsDescription: 'Manage subscription providers and OpenAI-compatible APIs as product choices.',
    providerName: 'Provider name',
    billingType: 'Billing type',
    providerKind: 'Provider kind',
    providerProduct: 'AI product',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    modelId: 'Model ID',
    executable: 'Command executable',
    fixedArgs: 'Fixed arguments (JSON array)',
    networkScope: 'Network scope',
    commandProfile: 'Command profile',
    saveProvider: 'Save',
    openRouterZaiOnly: 'Use Z.ai only on OpenRouter (no fallback)',
    savingProvider: 'Saving…',
    newOpenAiProvider: 'New OpenAI-Compatible Provider',
    savedProviders: 'Saved providers',
    editProvider: 'Edit',
    testConnection: 'Test connection',
    testingConnection: 'Testing…',
    disableProvider: 'Disable',
    subscriptionLabel: 'Subscription',
    subscriptionRole: 'Fixed role',
    subscriptionModel: 'Model',
    subscriptionStatus: 'Authorization status',
    lastProbe: 'Last health check',
    setupRequired: 'Setup Required',
    authorizationExpired: 'Reauthorization Required',
    probePending: 'Probe Pending',
    temporarilyUnavailable: 'Temporarily Unavailable',
    providerDisabled: 'Disabled',
    operatorAuthorizationGuidance: 'Authorize or reauthorize through the approved operator procedure on the worker host. The browser never authenticates accounts or activates subscription access.',
    httpTestCostWarning: 'Test Connection can issue a real completion and consume API quota or cost.',
    providerSaved: 'Provider settings saved.',
    secretStored: 'Stored key',
    connectionReady: 'Provider available',
    connectionUnavailable: 'Provider unavailable',
    connectionResponseInvalid: 'Provider response format needs attention',
    connectionRequestRejected: 'Provider rejected the connection request',
    noProviders: 'No providers have been saved.',
    roleAssignments: 'Role assignments',
    providerEnabled: 'Provider enabled',
    providerPriority: 'Provider priority',
    modelEnabled: 'Model enabled',
    modelPriority: 'Model priority',
    adminLoginTitle: 'Admin login',
    adminPassword: 'Admin password',
    adminTotp: 'Authenticator code (if enabled)',
    adminLogin: 'Log in',
    adminLogout: 'Log out',
    invalidLogin: 'The login credentials are invalid.',
    researchNow: 'Research Now',
    researchNowQueued: 'Added to queue',
    researchNowError: 'Research could not be queued.',
    navDashboard: 'Dashboard',
    competitionLabel: 'Competition',
    navCandidates: 'Candidates',
    navRuns: 'Runs',
    navSettings: 'Settings',
    candidatesTitle: 'Candidates',
    runsTitle: 'Research runs',
    settingsTitle: 'Research settings',
    queuedLabel: 'Queued',
    runningLabel: 'Running',
    waitingLabel: 'Waiting',
    completedLabel: 'Completed',
    apiBudgetLabel: 'API budget',
    demandLabel: 'Demand',
    marginLabel: 'Margin',
    differentiationLabel: 'Differentiation',
    noRuns: 'No research runs yet.',
    waitingBudgetLabel: 'Waiting for API Budget',
    needsAttentionLabel: 'Needs Attention',
    providerActive: 'Active',
    settingsLocale: 'Locale',
    settingsTimezone: 'Timezone',
    settingsAllocation: 'API allocation by cohort',
    settingsManualReserve: 'Manual reserve',
    settingsReadOnly: 'Read-only view. Operational settings are managed through the approved server procedure.',
    reserveLabel: 'Reserved',
    evidenceLabel: 'Evidence collected',
    noEvidence: 'No evidence has been collected yet.',
    runPlanningLabel: 'Planning',
    runFanoutLabel: 'Fan-out',
    failedLabel: 'Failed',
    sourceScheduled: 'Scheduled run',
    sourceManual: 'Manual run',
    stateDiscovered: 'Discovered',
    stateRuleFilter: 'Rule filter',
    stateAiScreening: 'AI screening',
    stateReadyForApiValidation: 'Ready for API validation',
    stateWaitingForApiBudget: 'Waiting for API budget',
    stateApiValidationRunning: 'API validation running',
    stateDeepResearch: 'Deep research',
    stateStrong: 'Strong',
    stateWatch: 'Watch',
    stateReject: 'Reject',
    stateNeedsReview: 'Needs review',
    stateWaitingForAiCapacity: 'Waiting for AI capacity',
    stateNeedsAttention: 'Needs attention',
    researchNowOverride: 'Use reserved budget',
    researchNowOverrideConfirm: 'Run Research Now using the reserved API budget?',
    briefingBasis: 'Page retrieved at (UTC)',
    briefingUnavailable: 'Research status is unavailable.',
    briefingNeedsReview: 'Candidates needing review: {count}.',
    briefingInProgress: '{count} candidates are in progress.',
    briefingRecorded: '{count} candidates are on record.',
    queueTitle: 'Decision queue',
    queueOrderNote: 'Needs-review states appear first, then candidates are ordered by preliminary score.',
    openCandidate: 'Open candidate',
    noReasonRecorded: 'No recorded rationale.',
    queueEmptyHint: 'Import a CSV to register Opportunity Finder keywords as candidates.',
    pulseTitle: 'Pipeline pulse',
    pulseUnitNote: 'Imports count runs; the stages that follow count candidates.',
    pulseStageImports: 'Imports',
    pulseStageDiscovery: 'Discovery',
    pulseStageValidation: 'Validation prep',
    pulseStageDecided: 'Decided',
    pulseNeedsReview: 'Needs review',
    pulseEmpty: 'The pipeline is empty. Import a CSV to create candidates.',
    statusUnavailable: 'Status is unavailable.',
    jobsTitle: 'Job queue',
    jobsZero: 'No jobs are waiting.',
    budgetNoRecord: 'No budget record for today.',
    budgetZero: 'No API budget is available for today.',
    budgetBlocked: 'Budget is exhausted; {count} candidates are waiting.',
    budgetRemainingLabel: 'Remaining',
    researchNowPending: 'Queueing…',
    providerGroupIdentity: 'Provider identity',
    providerGroupCapability: 'Capability and role',
    providerGroupRouting: 'Routing and priority',
    providerGroupConnection: 'Secure connection',
    briefingBudgetWait: '{count} candidates are waiting for API budget.',
    briefingCapacityWait: '{count} candidates are waiting for AI capacity.',
    briefingDecided: '{count} candidates are fully decided.',
    focusTitle: 'Focus now',
    focusOrderNote: 'Groups run from needs-review and blocked states first; candidates inside each group are ordered by preliminary score.',
    groupMore: 'Show {count} more candidates in this state',
    groupAllCandidates: 'See all {count} in Candidates',
    confidenceNotice: 'No recorded rationale yet for the candidates in this group.',
    bottleneckTitle: 'Pipeline bottleneck',
    bottleneckNone: 'No blocked stage is recorded.',
    bottleneckFlowing: '{count} candidates moving without a block',
    pipelinePathLabel: 'Candidates by stage',
    opsTitle: 'Operations',
    fleetTitle: 'Fleet status',
    fleetEnabled: 'Enabled',
    fleetAttention: 'Need attention',
    fleetRoles: 'Roles',
    fleetTotal: 'Total',
    addProvider: 'Add provider',
    testSectionTitle: 'Connection test result',
    workspaceNewHint: 'Save the provider to enable connection testing.',
    navPhaseJudge: 'Judge',
    navPhaseOperate: 'Run & operate',
    navPhaseAi: 'AI operations',
    detailVerdictQuestion: 'Is the evidence strong enough to advance this opportunity?',
    detailSignalsTitle: 'Core signals',
    importsFreshness: 'Data as of',
    detailGapTitle: 'Evidence still missing',
    detailNextTitle: 'Next verification',
    detailNoScore: 'No score has been computed yet. Evidence collection comes first.',
    decisionCallTitle: "Today's decision",
    decisionWhy: 'Why',
    decisionGap: 'Not yet verified',
    decisionGapNone: 'The recorded evidence is sufficient to decide.',
    decisionAct: 'Next action',
    decisionEmptyTitle: 'No candidates to judge yet.',
    decisionEmptyBody: 'Import a CSV to register Opportunity Finder keywords as candidates and create the first judgment.',
    researchObjectLabel: 'Research object',
    recordsInGroup: '{count} records',
    groupShowRecords: 'Show {count} records for this keyword',
    groupHideRecords: 'Collapse records',
    groupStatesSummary: 'Stages: {states}',
    scoreNotVerdict: 'The score is an early screening value, not a decision.',
    preVerificationLabel: 'Pre-verification',
    preVerificationDetail: 'No evidence collected yet; it cannot be judged.',
    groupNextActionOpen: 'Open a record to review',
    importsRecordSummary: '{files} files · {rows} raw rows · {keywords} unique keywords',
    importsSameTimestampNote: 'The entries below are separate import records.',
    importRecordOrdinal: 'Record {ordinal}',
    signalsNotComputed: 'Not computed',
    importTimestampNote: 'Separate import records registered at the same time. Record numbers are list positions, not source identifiers.',
    navCurrentLocation: 'Current location: {page}',
    candidatesJudgeNote: 'Each row shows the judgment phase, evidence state, and next action together. Compare from the top and decide.',
    candidatesColJudgment: 'Judgment',
    candidatesColConfidence: 'Evidence',
    candidatesNextAction: 'Next',
    runsProvenanceNote: 'Each run traces when and where the data behind candidate judgments was produced.',
    importsProvenanceNote: 'Imports are the origin of candidate data; the most recent entries carry the freshest judgment basis.',

  }
} as const satisfies Record<Locale, CopyDictionary>;

export function getCopy(locale: Locale): CopyDictionary {
  return COPY[locale];
}
