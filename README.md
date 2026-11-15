# 리서치 포켓 1.1

유튜브 링크 수집과 Gemini 노트북 본문 추출을 옆 패널에서 실행하는 Chrome / Edge 확장 프로그램입니다. 별도 서버·API 키·npm 설치 없이 `extension` 폴더를 불러오면 됩니다.

## 다른 PC에서 설치

**방법 A — git**

```powershell
git clone https://github.com/Hanriverflow/notebookLM-research-helper.git
```

**방법 B — git 없이**: [저장소 페이지](https://github.com/Hanriverflow/notebookLM-research-helper)에서 **Code → Download ZIP**으로 받아 압축을 풉니다. (또는 `dist/research-pocket-1.1.0.zip`만 받아 풀어도 됩니다.)

그다음 `chrome://extensions`(Edge는 `edge://extensions`) → **개발자 모드** 켜기 → **압축해제된 확장 프로그램 로드** → 받은 폴더 안의 `extension` 폴더 선택.

업데이트: 방법 A는 `git pull` 후 확장 프로그램 카드의 새로고침(↻) 버튼, 방법 B는 새 ZIP으로 폴더를 교체한 뒤 새로고침. 폴더를 지우거나 옮기면 확장 프로그램이 사라지니 고정된 위치에 두세요.

## 설치와 사용

1. `extension/help.html`을 열어 설치 안내를 확인합니다.
2. `chrome://extensions` 또는 `edge://extensions`에서 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램 로드**로 `extension` 폴더를 선택하고 아이콘을 고정합니다.
4. 유튜브 → 영상 모으기 → 선택 → 링크 복사하고 노트북 열기.
5. 노트북의 소스 추가 → 웹사이트에 붙여넣기 후 가져오기를 기다립니다.
6. 자료 저장 → 소스 불러오기 → 추출 → .md 파일 저장.

가져오기는 사용자가 노트북 UI에서 수행합니다. 확장 프로그램은 노트북에 자료를 자동 추가하거나 기존 자료를 수정·삭제하지 않습니다. 클립보드에는 버튼을 누를 때 선택한 링크 또는 본문을 씁니다.

## 목록과 추출 결과 관리

- 여러 패널에서 모은 영상은 같은 목록에 저장합니다. 다른 패널의 추가·선택·삭제도 반영합니다.
- 제목·채널·URL로 검색합니다. 전체 선택은 화면에 표시된 검색 결과에 적용합니다.
- 선택한 영상을 삭제하고 최근 삭제를 되돌릴 수 있습니다. 되돌리기는 다른 패널에서 추가한 영상을 보존합니다. 삭제 취소는 5분 동안 사용할 수 있으며 최근 10회까지 보관합니다.
- 직접 붙여 넣은 링크를 나중에 페이지에서 수집하면 비어 있는 제목과 채널 정보를 채웁니다.
- 현재 창에 노트북이 여러 개 열려 있으면 대상을 선택합니다.
- 최신 본문 추출은 완료했던 자료도 다시 요청합니다. 실패·미완료 재시도는 필요한 자료만 요청합니다.
- 최신 본문 추출이 실패하거나 중단되면 이전 성공 본문을 보존합니다. 화면과 Markdown에 이전 본문 사용 사실과 추출 시각을 표시합니다.
- 소스 목록에서 해석하지 못한 항목도 누락 목록으로 표시합니다. 본문을 하나도 가져오지 못했더라도 누락 보고서를 저장할 수 있습니다.
- 요청 제한이 발생하면 대기 중인 추출을 멈추고 다시 시도할 수 있는 시각을 안내합니다. 이미 시작한 요청은 완료될 수 있습니다.

## 데이터와 권한

- `scripting`: 사용자가 누른 작업을 유튜브/노트북 탭에서 실행.
- `sidePanel`: 브라우저 옆 패널 표시.
- `storage`: 영상 목록과 선택 상태를 브라우저 로컬 저장소에 보관 (최대 500개).
- `clipboardWrite`: 선택한 링크·본문 복사.
- 사이트 접근은 `www.youtube.com`, `notebook.google.com`, `notebooklm.google.com` 세 호스트로 한정.
- 외부 분석 서버, 추적, 원격 스크립트, 별도 인증 키 없음.
- 노트북 로그인 정보는 페이지 내부 요청에만 사용하고 확장 프로그램 저장소로 가져오지 않음.
- 노트북 본문은 패널 메모리에만 유지. 패널을 닫거나 다른 노트북을 불러오기 전에 파일로 저장. 패널 종료 후 본문 복구 기능은 제공하지 않음.

## 알려진 범위

- 데스크톱 Chrome 116 이상 / Chromium 기반 Edge의 Side Panel API가 필요합니다.
- 검색 결과·채널 동영상·재생목록·일반 영상 지원. 쇼츠는 수집하지 않습니다.
- 자동 스크롤은 최대 45회로 제한합니다. 현재 페이지가 실제로 불러온 목록에 따라 목표 수보다 적게 수집될 수 있습니다.
- YouTube 자막, 노트북에 저장된 텍스트를 추출합니다. 영상 파일·이미지·PDF 원본을 다운로드하지 않습니다.
- 노트북 추출은 원본 북마클릿과 같은 내부 RPC(`rLM1Ne`, `hizoJc`)를 사용하므로 Google 서비스 변경에 따라 업데이트가 필요할 수 있습니다. 응답 형식 불일치·타임아웃·HTTP 오류는 사용자에게 표시합니다.
- 선택한 소스 중 실패·미완료 목록과 해석하지 못한 소스 목록을 Markdown에 포함합니다. 재시도와 최신 본문 추출은 별도 작업입니다.
- 수집 도중 같은 탭의 주소가 바뀌면 수집을 멈춥니다. 이미 저장한 영상은 남습니다.
- 본문에서 숫자만 있는 줄이나 인용번호를 자동 삭제하지 않습니다.

## 개발과 검증

Node.js 20 이상. 런타임·테스트 모두 외부 npm 의존성이 없습니다.

```powershell
npm test
npm run check
npm run preview
```

미리보기는 `http://127.0.0.1:4318`에서 열립니다. 실제 브라우저 API가 없으므로 설치 안내 상태로 표시됩니다. `?qa=1`은 명시적인 테스트 데이터 모드이며 실제 사용자 자료가 아닙니다. 테스트 도구와 fixture는 배포 ZIP에 포함하지 않습니다.

아이콘 재생성: `python tools/build-icons.py`.

배포 파일 생성과 검사:

```powershell
python tools/build-package.py
python qa/improvements/verify-package.py
```

현재 검증 범위와 실제 브라우저 검증의 제한은 [VALIDATION.md](VALIDATION.md)를 참조하세요.

## 출처

오빠두엑셀 [Gemini 노트북과 AI로 리서치 자료 정리하기](https://www.oppadu.com/notes/ypyp4efa22/)의 두 북마클릿을 참고하여 새 UI와 작업 제어를 구현했습니다. 사용자 개인용 로컬 도구로 만들었습니다.

Chrome 공식 문서: [Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [로컬 확장 설치](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).
