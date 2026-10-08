# 유튜브 업로드 자료: AI 토큰 사용량 대시보드 (token-dashboard)

영상: https://youtu.be/ouR9nL3lefw
GitHub: https://github.com/LanturnHouse/token-dashboard

---

## 1. 제목 후보 (60자 이하)

| # | 제목 | 글자 수 |
| --- | --- | --- |
| 1 | **Claude Code 토큰, 어디로 샜나? 실시간 사용량 대시보드 만들기** (추천) | 40자 |
| 2 | Claude Code + GPT 토큰 얼마나 쓰는지 한눈에 보는 대시보드 | 40자 |
| 3 | 내 AI 토큰은 어디로 갔나? Claude Code·GPT 사용량 대시보드 | 41자 |
| 4 | Claude Code 서브에이전트 토큰·작업시간·비용 한 번에 보기 | 37자 |
| 5 | Claude Code 토큰 비용 약 $4,300? 실시간 대시보드로 확인 | 40자 |

추천 이유: "Claude Code"와 "토큰"이 앞에 오고, "어디로 샜나?"가 호기심을 자극합니다. 채택한 썸네일 B("토큰, 얼마나 썼나?" + 11.6B)와 맞추려면 2번 또는 5번도 잘 어울립니다.

---

## 2. 설명란 (description)

```
Claude Code를 쓰다 보면 "이번 달 토큰이 대체 어디로 갔지?" 싶을 때가 있습니다.
이 영상은 Claude Code와 OpenAI Codex(GPT) 사용 기록을 한 화면에서 실시간으로 보여주는
로컬 대시보드 'token-dashboard'를 소개합니다.

이 대시보드가 보여주는 것
- 세션별, 서브에이전트별 토큰 사용량과 작업 시간
- 지금 작업 중인 세션 (실시간으로 시간이 올라가는 카드)
- 일별 / 시간별 / 모델별 차트 (모델마다 다른 색)
- 추정 비용 (USD, API 정가 기준)
- Claude / GPT 토글
- GPT 요금제 사용 한도 게이지 (5시간 / 주간)

주요 특징
- 로컬 전용: 127.0.0.1 에서만 접속 가능합니다.
- 읽기 전용: ~/.claude, ~/.codex 기록을 읽기만 하며 데이터를 수정하거나 입력을 보내지 않습니다.
- 의존성 0개: Node.js 내장 모듈만 사용합니다. npm install이 필요 없습니다.

바로 실행하기 (Windows, 설치 불필요)
- 다운로드: https://github.com/LanturnHouse/token-dashboard/releases/latest
- zip을 풀고 token-dashboard.exe 를 더블클릭하면 브라우저가 자동으로 열립니다.
- 서명되지 않은 파일이라 SmartScreen 경고가 뜨면 '추가 정보 → 실행'을 누르세요.

소스로 실행하기
1. Node.js 20 이상을 설치합니다 (24 권장).
2. 저장소를 받습니다.
   git clone https://github.com/LanturnHouse/token-dashboard
   cd token-dashboard
3. 서버를 실행합니다.
   node server.js
   (Windows에서는 start.bat 을 더블클릭해도 됩니다)
4. 브라우저에서 http://localhost:7777 에 접속합니다.
   처음 실행 시 전체 스캔에 수 초에서 수십 초가 걸립니다. 이후에는 캐시를 사용해 빠르게 열립니다.

GitHub: https://github.com/LanturnHouse/token-dashboard

이렇게 만들었습니다
- 대시보드 전체를 Claude Code로 만들었습니다.
- 서브에이전트 역할 분담: 메인 Opus (설계와 조율), Sonnet (코드 리뷰), Haiku (코딩).
- 스택: Node.js (HTTP 서버, 로그 파싱, 증분 집계), 정적 HTML/CSS/JS 프런트엔드. 외부 패키지 없음.

타임스탬프 (실제 시간으로 수정하세요)
00:00 소개
00:40 대시보드 한눈에 보기
01:30 세션 / 서브에이전트 토큰과 작업 시간
03:00 실시간 작업 중 세션
04:10 일별 / 시간별 / 모델별 차트
05:20 추정 비용과 Claude / GPT 토글
06:10 GPT 사용 한도 게이지
07:00 직접 실행해 보기
08:00 마무리

참고
- 비용은 모두 API 정가 기준의 추정치입니다. 실제 청구 금액과 다를 수 있습니다.
- ChatGPT 요금제로 쓴 Codex 사용량은 토큰 단위로 과금되지 않으므로, 여기 표시되는 비용은 참고용입니다.
- 영상의 데이터는 개인정보를 가린 데모 데이터입니다.

#ClaudeCode #AI토큰 #OpenAICodex #Nodejs #개발도구
```

---

## 3. 태그 (18개, 쉼표로 구분)

```
Claude Code, Claude, Anthropic, 토큰 사용량, AI 토큰, 토큰 대시보드, OpenAI Codex, GPT, Codex CLI, 사용량 대시보드, 비용 추정, Node.js, 서브에이전트, 서브 에이전트, 개발 도구, 로컬 대시보드, 오픈소스, 바이브 코딩
```

---

## 4. 해시태그 (5개)

#ClaudeCode #AI토큰 #OpenAICodex #Nodejs #개발도구

---

## 5. 고정 댓글 (pinned comment) 제안

```
영상 보시고 궁금한 점 남겨주세요!
GitHub 저장소: https://github.com/LanturnHouse/token-dashboard
(비용은 API 정가 기준 추정치입니다. 실제 청구액과 다를 수 있어요.)
Claude만 쓰시나요, GPT도 같이 쓰시나요? 여러분의 토큰 사용 패턴이 궁금합니다. 댓글로 알려주세요.
```

---

## 6. 썸네일 파일

- `D:/token-dashboard/docs/youtube/thumbnail.png` (미사용 대안): 헤드라인 "내 AI 토큰, 어디로 갔나?" + 기울어진 대시보드 캡처 + 모델 색 칩
- `D:/token-dashboard/docs/youtube/thumbnail-b.png` (**채택**): "토큰, 얼마나 썼나?" + 큰 11.6B 숫자 + 대시보드 캡처 전체 폭
- 소스: `thumbnail.html`, `thumbnail-b.html` (둘 다 1280x720). 캡처 이미지: `dashboard-capture.png` (데모 서버 localhost:7778 에서 캡처)
