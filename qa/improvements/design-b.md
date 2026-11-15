# 설계 B — 명령을 받는 단일 영상 저장소

## 사용부터

영상 패널은 검색으로 보이는 항목만 좁히고, 체크한 링크를 복사하거나 선택 삭제한다. 전체 선택은 현재 검색 결과에만 적용한다. 삭제한 직후에는 해당 삭제만 되돌린다. 다른 창에서 추가하거나 선택한 영상은 그대로 남는다. 500개가 차면 새 영상만 거절하고 기존 영상의 제목·채널 보강은 계속 허용한다.

자료 패널은 현재 창의 열린 노트북을 제목·계정 구분값·주소로 나열한다. 하나를 선택하면 그 탭을 대상으로 목록을 읽는다. `실패·미완료 다시 추출`은 최신 시도가 실패했거나 본문 없는 항목만, 별도 `선택한 자료 최신 본문 추출`은 성공했던 항목도 요청한다. 재추출 실패 시 마지막 성공 본문은 유지하며 화면과 Markdown에 이전 본문 사용과 오류를 표시한다. 일부 목록 행을 읽지 못해도 읽은 소스와 누락 경고를 함께 내보낸다.

```js
// panel.js — 배열을 저장하지 않고 의도를 보낸다.
const unsubscribe = watchLibrary(snapshot => { state.library = snapshot; renderVideos(); });
applyLibrary(await editLibrary({ kind: 'read' }));
await editLibrary({ kind: 'add', videos: linksFromText(input.value) });
await editLibrary({ kind: 'select', ids: visibleVideos().map(v => v.id), selected: true });
const { undoToken } = await editLibrary({ kind: 'delete', ids: selectedVideos().map(v => v.id) });
await editLibrary({ kind: 'undo', token: undoToken });

// 최신 추출/실패 재시도는 이름 있는 모드로 구별한다.
await extractNotebook({ mode: 'fresh', session: state.notebookSession, onChange: renderSources });
await extractNotebook({ mode: 'retry', session: state.notebookSession, onChange: renderSources });
download(composeMarkdown(state.notebookSession), filename);
```

`watchLibrary`를 먼저 등록하고 초기 읽기를 한다. 반환된 스냅샷은 `revision`이 현재보다 클 때만 적용한다. 화면 조작의 성공 표시는 저장 완료 뒤에 한다. 선택 UI가 잠깐 늦는 편을 택하고, 낙관적 배열 수정과 재병합은 하지 않는다.

## 문제와 근거

`panel.js: persistVideos()`의 패널별 Promise는 다른 패널과 직렬화되지 않는다. `core.js: mergeVideos()`의 기존 우선 정책은 선택 보존에는 맞지만 URL만 있는 항목의 제목 보강까지 막는다. `extractSources()`는 `done`을 건너뛰고 실패 때 성공 본문과 최신 실패를 따로 표현하지 못한다. `page-actions.js`는 일부 잘못된 목록 행과 HTTP 종류를 버린다. 실제 인증은 주입 함수 내부에만 존재한다. 이 경계와 현재 호스트 권한을 유지한다. 별도 서버, npm 런타임 의존성, Notebook 수정 기능은 추가하지 않는다.

## 두 저장 형태 비교와 선택

| 형태 | 접근 경로 | 숨기는 복잡성 / 노출하는 비용 | 판단 |
| --- | --- | --- | --- |
| A. 서비스 워커 단일 작성자 | 패널 명령 → 워커 직렬 큐 → 한 키에 원자적 상태 교체 | 하나의 명령 API가 500 제한, 중복, 선택, 삭제, 되돌리기, 메타데이터 우선순위를 함께 보호한다. 워커 종료·재시도 규약이 필요하다. | **채택** |
| B. 영상별/작업별 분할 레코드 | `video:<id>`, `selection:<actor>:<id>`, `op:<uuid>`를 패널이 추가 → 읽을 때 접기 | 다른 키에 추가하는 충돌은 사라진다. 같은 영상의 선택·삭제에는 세대/인과 순서와 tombstone이 필요하고, 전역 500개 판정·로그 정리·Undo가 모든 읽기에 묶인다. 단순 per-video 쓰기는 동일 영상 충돌을 해결하지 못한다. | 기각 |

B를 온전히 구현하려면 immutable op 로그와 결정적 순서, 500개 활성 슬롯 계산, 동시 삭제/복원 규칙, 안전한 compaction까지 하나의 저장 프로토콜이 된다. 용량 제한을 읽기 투영으로만 적용하면 실제 저장은 무한 증가하고, 일부 패널은 거절된 영상을 수집 성공으로 오인한다. 결국 작은 조정자를 다시 도입한다. 이미 MV3 워커가 있으므로 A가 더 작은 공개 표면으로 전체 불변식을 소유한다. 패널 메모리 상태는 여전히 창마다 독립이며 Notebook 본문은 영상 저장소로 보내지 않는다.

## 데이터 형태

아래는 JS 구현을 위한 JSDoc 계약이다. 저장/메시지 봉투는 `video-store.js` 내부이며 UI에는 domain snapshot과 명령 결과만 노출한다.

```js
// VideoId = canonical URL의 11자리 영상 ID
// Video = { id, url, title, channel, selected, metadata: 'link'|'page'|'oembed' }
// LibrarySnapshot = { revision: number, videos: Video[] }
// Edit = {kind:'read'}
//   | {kind:'add', videos: VideoInput[]}
//   | {kind:'select', ids: VideoId[], selected: boolean} // toggle 금지
//   | {kind:'delete', ids: VideoId[]}
//   | {kind:'undo', token: string}
//   | {kind:'enrich', patches: {id, title, channel}[]}
// EditResult = { snapshot: LibrarySnapshot, addedIds: VideoId[],
//                refusedCount: number, undoToken?: string, unrestoredCount?: number }
// StoredLibraryV1 = { version:1, revision, videos, undoRecords }
// UndoRecord = { token, expiresAt, removed: {video, index}[] }

// NotebookRef = { tabId, windowId, origin, notebookId, accountSlot: string, title, url }
// NotebookKey = origin + notebookId + accountSlot (windowId는 세션 범위)
// NotebookSession = { key, ref: NotebookRef, generation, loadedAt,
//                     reportedCount, sources: Source[], omissions: Omission[], cooldownUntil }
// Source = { id, title, kind, url, channel, selected,
//            lastSuccess: null | { text, extractedAt },
//            attempt: { state:'idle'|'running'|'success'|'error'|'cancelled',
//                       startedAt?:number, error?:ReadError } }
// Omission = { rowIndex:number, title:string, reason:string } // RPC 원문 금지
// ReadError = { code:'rate-limit'|'context'|'timeout'|'network'|'schema'|'empty'|'http',
//               message:string, retryAt?:number }
// PageResult = {ok:true, context, ...domainData} | {ok:false, error:ReadError}
```

`lastSuccess`만 본문 보유 여부를 결정한다. `attempt`는 최신 시도의 결과다. Markdown은 성공 본문이 있으면 최신 시도가 실패/취소여도 본문과 성공 시각, 최신 실패 시각/이유, `이전 본문 사용`을 함께 출력한다. 성공 본문 없으면 누락 항목이다. 모든 원본 목록 행은 유효 소스 또는 omission 한 개로 분류하며 중복 ID도 omission으로 센다. `reportedCount === sources.length + omissions.length`를 유지한다. omission은 선택 불가능한 경고 행으로 항상 표시하고 export의 누락 절에 항상 포함한다. 제목은 확인 가능한 짧은 문자열만 사용하고 그 밖에는 `해석하지 못한 소스 #N`으로 고정한다.

## 모듈과 JS 시그니처

새 런타임 모듈은 **video-store.js 하나**다. Notebook 큐는 기존 panel.js에서 이름 있는 함수들로 유지한다. 기존 core.js는 순수 정책을 모은다.

```js
// extension/video-store.js — storage representation, transport, write ownership 전부
export function installVideoStore(chromeApi) { throw new Error('not implemented'); }
export async function editLibrary(edit) { throw new Error('not implemented'); }
export function watchLibrary(onSnapshot) { throw new Error('not implemented'); } // → unsubscribe

// extension/core.js — Chrome/DOM 없이 검사하는 domain 정책
export function reduceLibrary(stored, edit, now) { throw new Error('not implemented'); }
export function visibleVideos(videos, query) { throw new Error('not implemented'); }
export function mergeNotebookSession(previous, result, now) { throw new Error('not implemented'); }
export function extractionTargets(session, mode) { throw new Error('not implemented'); }
export function composeMarkdown(session, date = new Date()) { throw new Error('not implemented'); }

// extension/panel.js — UI, 탭 선택, 작업 수명
async function listNotebookTabs() { throw new Error('not implemented'); }
async function loadSources(ref) { throw new Error('not implemented'); }
async function extractNotebook({mode, session, onChange}) { throw new Error('not implemented'); }
async function enrichLinks(ids) { throw new Error('not implemented'); }
function stopJob() { throw new Error('not implemented'); }

// extension/page-actions.js — 직렬화 함수이므로 import나 외부 closure 사용 금지
export function collectYouTube({scroll=false, expectedRoute=null}={}) { throw new Error('not implemented'); }
export async function readNotebook({operation, expectedContext, sourceId}={}) { throw new Error('not implemented'); }
```

`background.js`는 모듈 워커로 바꾸고 `installVideoStore(chrome)`를 동기 최상위에서 호출한 뒤 기존 sidePanel 설정을 실행한다. manifest background에 `type: module`만 추가한다. `permissions`, `host_permissions`는 그대로 둔다. `core.js`에 새 reducer를 두되 원시 stored 형태는 UI가 접근하지 않는다. 다른 모듈이 `chrome.storage.local.set()`로 영상을 쓸 경로를 전부 삭제한다.

## 명령, 복구와 불변식

```text
installVideoStore:
  onMessage listener를 await 이전에 등록
  확장 자신의 sender와 메시지 schema 확인; 자기 namespace 아니면 응답하지 않음
  listener는 비동기 sendResponse를 위해 literal true 반환
  tail = tail.catch(...).then(handle) // 한 실패가 다음 명령을 막지 않음

handle:
  storage.local에서 videoLibraryV1 읽음 (워커 전역 캐시를 신뢰하지 않음)
  없을 때만 legacy videos 배열을 기존 정규화/순서/selected 규칙으로 최대500개 가져옴
  기존 V1이 있으나 잘못됐으면 쓰기 중지/명시적 오류; legacy로 되돌려 덮지 않음
  read도 같은 큐 안에서 migration 완료를 기다림
  만료 Undo 정리
  reducer 실행 → revision 증가 → snapshot과 undo를 한 키에 함께 set
  set 성공 뒤 응답; 실패 때 현재 UI를 성공으로 바꾸지 않음
```

워커 Promise 큐는 실행 중 직렬화만 담당한다. 영속 정보는 한 저장 키에 있으므로 워커가 다시 시작해도 마지막 완료 상태를 읽는다. 메시지 채널은 저장 작업 종료까지 유지하며 HTTP, 추출, 타이머는 워커 큐에 넣지 않는다. 명령은 수초 내의 로컬 작업만 한다.

변경 명령을 자동 재전송하지 않는다. 응답이 유실되면 성공/실패를 추측하지 않고 `read`로 실제 상태를 확인한 후 안내한다. 확인이 실패하면 변경 UI를 잠시 잠그고 다시 읽기 버튼을 준다. 버튼 중복 클릭도 명령 응답 전까지 막는다. 이 정책으로 영속 명령 로그나 receipt 저장소 없이 불확실한 변경의 자동 중복 적용을 피한다. Undo 토큰은 복원과 함께 한 저장 키에서 소비하여 같은 토큰으로 두 번 복원하지 못한다.

1. ID별 영상은 하나, 순서는 기존 우선, 활성 영상은 항상 500 이하. 500개 상태에서도 기존 항목 보강 가능.
2. add는 기존 선택을 절대로 바꾸지 않는다. select는 전달된 ID의 현재 존재 항목만 수정한다. 삭제된 ID를 다시 만들지 않는다.
3. enrich는 현재 존재 항목의 비어 있는 채널과 URL 그대로인 제목만 보강한다. 기존 정상 제목/선택은 덮지 않는다. 비동기 응답으로 삭제 영상이 부활하지 않는다.
4. delete는 명령 시점 존재하는 지정 ID만 삭제한다. `clear` 버튼도 현재 화면에서 확인한 전체 ID의 delete로 구현하여 다른 패널의 나중 추가를 지우지 않는다.
5. Undo는 토큰에 기록된 삭제 항목만 원래 상대 순서로 넣고 현재 존재 항목은 그대로 둔다. 현재 없는 ID만, 남은 슬롯까지만 복원하며 수량을 알린다. 토큰은 한 번에 소비한다. Undo는 5분/최근10회로 한정하며 잘린 기록의 토큰은 만료 오류다. 삭제 기록에 Notebook 본문은 없다.
6. 동일 영상의 동시 select는 워커 접수 순서의 마지막 명시 값이 이긴다. 이는 다른 영상의 수정 유실과 구별되는 정상 충돌 규칙이다.
7. 저장 이벤트와 늦은 command 응답 모두 같은 `applyLibrary(snapshot)`를 통과한다. 작은/equal revision은 무시해 화면 회귀를 막는다. UI의 검색어와 Notebook 상태는 이 스냅샷에 넣지 않는다.

## 수집과 메타데이터

첫 읽기에서 주입 함수가 현재 문맥의 route key를 반환한다. 검색은 pathname+정렬된 검색 조건(검색어와 필터 포함), 채널은 정규 channel path+videos+sort 조건, 재생목록은 list ID+현재 순서 조건, 단독 영상은 v ID를 쓴다. 추적 파라미터만 제외하고 모르는 의미 있는 query는 보존한다. 다음 읽기와 스크롤에 expectedRoute를 전달한다. 함수 진입과 반환 직전에 현재 route를 비교하고 다르면 `context` 오류로 영상을 반환하지 않는다. panel도 첫 route와 결과가 같을 때만 add한다. tab ID만 같다는 이유로 수집하지 않는다. 한 라운드의 저장은 그 라운드 응답을 검증한 뒤 완료한다.

직접 입력은 URL fallback으로 먼저 저장한다. 이후 현재 권한에 포함된 `https://www.youtube.com/oembed?url=...&format=json`만 패널에서 요청하여 title/author_name을 얻는다. 동시1개, 요청 타임아웃8초, 개별 실패는 링크 사용을 막지 않고 재시도 버튼으로 재실행한다. 새 입력이 들어올 때 없는 메타데이터만 큐에 넣고, 수집 DOM에서 같은 영상을 발견하면 같은 enrich 명령으로 채운다. oEmbed 실패 시 외부 호스트/API/추가 권한을 요청하지 않는다. 에러는 짧은 UI 안내이며 URL과 토큰을 포함한 상세 응답은 저장하지 않는다.

## Notebook 문맥과 큐

`tabs.query({currentWindow:true})`의 개별 Notebook 탭을 모두 picker에 넣는다. 홈은 새 노트북 열기 후보일 뿐 소스 읽기 대상이 아니다. 각 항목은 tabId로 선택하며 같은 노트북의 중복 탭도 선택 가능하다. 활성 탭과 대상 노트북은 별개다. 탭 삭제/이동/주소 변경 시 선택 후보를 갱신하고, 선택 대상을 조용히 다른 탭으로 바꾸지 않는다.

목록 결과가 반환하는 문맥은 origin, notebookId, 실제 authuser slot이며 URL의 authuser와 W.QrtxK의 기존 우선순위를 사용한다. 본문 요청은 이 문맥 전체를 expectedContext로 전달하고 MAIN 함수가 **fetch 전후** 다시 확인한다. 계정/노트북이 달라졌으면 본문을 적용하지 않는다. `runInTab`은 오류 code/retryAt를 보존하며 문자열 Error로 평탄화하지 않는다. 인증 토큰과 WIZ 객체는 반환하지 않는다.

```text
extractNotebook(mode):
  targets = selected && (mode=fresh || !lastSuccess || attempt.state=error/cancelled)
  job = {epoch, cancelled:false, contextKey}; 한 번에 한 작업만
  cooldownUntil 미래면 네트워크 없이 남은 대기 안내
  for target of targets: // concurrency=1; rate-limit 이후 추가 시작을 구조적으로 막음
    취소/context generation 불일치면 중단
    attempt만 running으로 변경; lastSuccess는 유지
    result = readNotebook(expectedContext, sourceId)
    epoch/context 불일치면 응답 폐기
    성공하면 lastSuccess를 원자적으로 교체하고 attempt=success
    일반 실패는 attempt=error 후 다음 소스
    rate-limit이면 attempt=error; cooldownUntil 기록; 즉시 루프 종료
```

429의 Retry-After가 있으면 초/HTTP-date를 해석하고, 없으면 30초부터 연속429 횟수에 따라 두 배(최대5분)의 대기 시각을 준다. 응답이 지정한 더 긴 대기를 짧게 자르지 않는다. 자동 재개하지 않고 UI에 남은 시간과 `실패·미완료 다시 추출`을 제공한다. 성공이 있으면 연속429 카운터를 초기화한다. 목록 읽기의 429도 같은 Notebook/account cooldown을 사용한다. 대기 중에는 타이머 큐를 실행하지 않으므로 중지/대상 변경이 즉시 가능하다.

중지는 즉시 cancelled/epoch를 갱신해 더 시작하지 않게 하고, 주입 fetch는 기존25초 timeout 안에 끝나도록 둔다. 아직 active 요청이 있으면 중지 상태를 표시하며 새 추출 시작을 막는다. 늦은 응답은 반영하지 않는다. 대상 전환/목록 갱신도 generation을 바꾸며 이전 완료가 새 화면에 스며들지 않는다. 이전 성공 본문은 계속 export 가능하다. 부분 목록 재읽기는 같은 NotebookKey의 같은 sourceId에 한해 선택/본문/실패를 보존한다. 사라진 소스를 현재 목록에 몰래 복원하지 않는다.

## 임시 본문 복구

이번 구현은 복구 옵션을 추가하지 않는다. 기본 OFF이며 본문은 기존대로 패널 메모리에만 둔다. 재시작 복구를 이후 구현할 경우에도 `chrome.storage.session`의 메모리 영역만 사용하고 access level을 확장 trusted context로 유지한다. local/sync/IndexedDB로 본문을 이동하지 않는다. 키는 windowId+origin+notebookId+account discriminator, 최대5개 문맥/전체4MiB/TTL2시간, 초과 시 오래된 문맥부터 제거한다. `이 노트북 지우기`, `전체 임시 본문 지우기`, OFF 전환 즉시 전체 삭제가 필수다. 복구는 명시적 opt-in 이후 동일 문맥을 재검증한 뒤에만 하며 계정을 안정적으로 구별할 수 없으면 복구하지 않는다. 현재 authuser slot만으로 로그인 교체를 완전히 식별할 수 없어, 그 확인을 생략한 캐시는 구현하지 않는다. 인증 토큰·쿠키·WIZ 데이터·RPC 원문은 어느 저장소에도 넣지 않는다.

## 검증과 인수 경계

기존 12개 테스트의 의미를 유지하며 composeMarkdown 계약을 새 session으로 한 번에 이관한다. 두 계약을 영구 지원하지 않는다. 실제 동작을 확인할 값은 다음과 같다.

- 서로 다른 초기 스냅샷을 가진 두 클라이언트가 add/select/delete를 교차 실행해 모두 반영되는지, 늦은 응답 뒤 화면 revision이 후퇴하지 않는지.
- 워커 재시작을 흉내내도 기존 데이터와 선택이 남고 응답 유실 후 명령 재전송 없이 최신 상태를 읽는지, 499개에서 동시 두 추가가 500개만 되는지.
- 삭제 뒤 다른 추가/선택 후 Undo가 그 변경을 보존하는지, 메타데이터 늦은 응답이 삭제를 취소하지 않는지.
- vm으로 readNotebook를 직렬화 실행하여 일부 불량행·중복 ID·429 Retry-After·본문 요청 전후 account 변경·timeout을 검증하는지.
- 성공→fresh 실패→export에서 이전 본문과 경고가 둘 다 나오고, retry는 그 항목을 다시 요청하며 deselected 본문이 유출되지 않는지.
- route 변경 직후 수집/스크롤을 멈추고 잘못된 결과가 저장되지 않는지, 세 소스 중 첫429 뒤 나머지 요청이 시작되지 않는지, 중지 후 늦은 응답을 무시하는지.

`tools/mock-chrome.js`는 runtime.onMessage/sendMessage, storage.onChanged, remove, 다중 탭/currentWindow를 구현하고 실제 `installVideoStore`와 reducer를 실행하는 테스트 셸로 바꾼다. mock에 별도의 저장 정책을 복제하지 않는다. 두 QA 페이지는 같은 origin localStorage+storage event 또는 BroadcastChannel로 한 저장 서비스를 공유하도록 하여 교차 패널 검증이 실제로 교차하도록 한다. 기존 scripting fixture는 route/context/typed error/Retry-After를 반환하도록 업데이트한다. QA 어댑터와 preview-server는 배포 패키지에 포함하지 않는다.

`npm test`, `npm run check`, preview의 두 패널/검색/선택삭제/Undo/노트북picker/부분누락/실패재추출을 확인한다. 실제 MV3 워커 메시지와 중단 후 재기동은 설치 확장에서 별도 확인해야 한다. preview만 통과하면 실제 계정 RPC·MV3 생명주기 검증 완료로 보고하지 않는다. 호스트 권한 배열은 변경 전과 정확히 비교한다.

## 판단 근거와 구현 순서

단일 저장 명령은 representation과 전역 제한을 한 곳에 감춘다(boundary-discipline, single ownership). 본문 성공과 시도 상태를 분리하여 UI/queue/export가 같은 사실을 읽게 한다(model-the-domain). 기존 세 파일에 정책을 집중하고 새 모듈은 저장 경계 한 개로 제한하여 얕은 pass-through 계층을 만들지 않는다(minimize-reader-load). 병렬 추출3개 대신1개를 허용해 처리량을 낮추는 대가로429 이후 발사·취소·상태 변경 계약을 단순하게 만든다.

이 후보의 synthesis 선택은 A다. 구현자는 먼저 core reducer와 워커 저장 메시지, 초기화/구독/마이그레이션을 연결하고 기존 persistVideos 작성 경로를 전부 없앤다. 그 계약이 두 클라이언트 테스트를 통과하면 Notebook 상태/주입 응답/큐와 export를 함께 이관하고, 마지막에 검색·삭제·Undo·picker UI 및 QA adapter를 연결한다. 이 설계를 위해 추가 사용자 결정을 기다릴 항목은 없다. 실제 RPC 포맷과 authuser slot의 한계는 실행 결과로 기록하며 복구 기능은 OFF로 유지한다.
