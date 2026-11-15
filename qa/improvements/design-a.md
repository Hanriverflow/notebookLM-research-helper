# 설계 A — 단일 작성자 영상 저장소

## 사용법을 먼저

사용자는 영상 링크를 추가하거나 수집하며, 열린 모든 패널에서 같은 목록과 선택 상태를 본다. 검색은 제목·채널·URL을 숨겨 보일 뿐 목록을 수정하지 않는다. ‘표시된 항목 전체 선택’은 현재 검색 결과의 URL만 지정한다. ‘선택 삭제’는 검색 밖 선택도 포함한 전체 선택 개수를 표시하고 그 URL만 삭제한다. ‘목록 비우기’도 클릭 순간 화면에 알고 있는 URL만 삭제하므로 다른 패널에서 막 추가한 항목을 지우지 않는다. 삭제 후 5분 동안 한 번 되돌릴 수 있다.

본문에는 ‘실패·미완료 재시도’와 ‘선택 자료 새로 추출’ 버튼이 따로 있다. 새 추출이 실패해도 직전 성공 본문은 남고, 화면과 Markdown에 성공 시각 및 최신 시도 실패를 함께 표시한다. 해석하지 못한 소스는 누락 항목으로 보이며 본문이 하나도 없어도 누락 보고서를 저장할 수 있다. 노트북 선택기는 현재 창의 열린 개별 노트북 탭을 나열한다.

실제 호출부의 형태는 다음 세 가지로 고정한다. 설명용 JS이며 구현 파일을 추가하지 않는다.

```js
const videos = connectVideos(chrome, snapshot => {
  state.videoSnapshot = snapshot;
  renderVideos();
});
await videos.ready;
await videos.command({ kind: 'add', items: linksFromText(input.value) });
await videos.command({ kind: 'select', urls: visibleUrls, selected: false });
const result = await videos.command({ kind: 'delete', urls: selectedUrls });
state.undoToken = result.undoToken;
await videos.command({ kind: 'undo', token: state.undoToken });

// 패널의 본문 상태와 큐는 패널 수명에 속한다.
await extractSources('fresh'); // selected && extractable, 성공 이력도 포함
await extractSources('retry'); // selected && extractable && 최신 성공 상태가 아님

// 코어는 저장 위치와 RPC 형식을 몰라도 내보내기 정책을 완결한다.
const markdown = composeMarkdown(state.notebook, state.sources);
```

## 문제와 기존 제약

`panel.js`는 패널별 `saveQueue`로 전체 `videos` 배열을 쓰므로 여러 패널이 서로의 추가·선택·삭제를 덮어쓴다. `mergeVideos`는 먼저 본 항목을 그대로 보존해 수동 링크의 제목·채널이 나중에도 비어 있다. `readNotebook`은 일부 잘못된 목록 행을 버리고 HTTP 429 종류를 문자열로 소실한다. `extractSources`는 `done`을 영구히 건너뛰며 본문 존재와 최근 요청 상태가 결합되어 있다. 기존 순수 함수 테스트, 주입 함수를 `toString()`으로 실행하는 VM 테스트, `tools/mock-chrome.js`를 유지·확장한다. 외부 런타임 의존성과 호스트 권한은 추가하지 않는다.

## 서로 다른 두 저장 구조 비교

| 구조 | 데이터와 읽기 | 동시 쓰기 | 숨기는 복잡성 / 노출하는 복잡성 | 판단 |
| --- | --- | --- | --- | --- |
| A. worker 단일 작성자 | 한 envelope의 ordered videos, revision, 명령 receipt, 삭제 undo | 패널은 명령만 전송, worker가 직렬 적용 후 한 번 set | 클라이언트는 명령과 snapshot만 이해; writer가 용량·중복·선택·undo·재시도 전부 소유 | 채택 |
| B. 영상·연산별 분할 기록 | `op:<actor>:<sequence>` 불변 연산, URL별 합성 뷰; 단순 URL 키 저장만으로는 같은 영상 충돌 미해결 | 고유 키 쓰기로 물리 덮어쓰기는 없음; 읽기에서 결정적 정렬·add/select/delete/undo 합성 | writer는 얇아지나 reader가 tombstone, 동일 영상 세대, 500개 경계, 연산 압축과 복구 의미를 알아야 함 | 기각 |

B는 실제 대안으로 가능하다. 연산 ID를 total order로 정렬하고 삭제 tombstone과 원래 삭제 연산을 가리키는 undo를 합성하며 최초 500개만 표시할 수 있다. 하지만 동시에 499→501개 추가되면 어떤 항목이 밀려나는지 사용자가 뒤늦게 보게 된다. 숨긴 초과 항목이 이후 다시 나타나지 않게 하려면 수락 기록까지 필요하다. 무한 연산 로그를 정리하려면 watermark/compaction 소유자가 다시 필요하고, 패널이 종료된 actor의 진행도를 처리해야 한다. 현재 최대 500개 소규모 목록에서 이 비용보다 한 번의 bounded 저장 직렬화가 작다. 단순 per-video record는 서로 다른 URL 추가만 고치고 같은 URL의 선택·삭제 경쟁을 해결하지 못한다.

## 데이터 형태

JSDoc discriminated union을 사용한다. wire envelope는 `video-store.js` 내부이며 panel이 저장 키나 receipt를 읽지 않는다.

```js
/** @typedef {{url:string, title:string, channel:string, selected:boolean}} Video */
/** @typedef {{revision:number, videos:Video[]}} VideoSnapshot */
/** @typedef {{kind:'add',items:Video[]} |
 * {kind:'enrich',items:Array<{url:string,title?:string,channel?:string}>} |
 * {kind:'select',urls:string[],selected:boolean} |
 * {kind:'delete',urls:string[]} | {kind:'undo',token:string}} VideoCommand */
/** @typedef {{snapshot:VideoSnapshot, added:number, changed:number,
 * skipped:number, undoToken?:string}} CommandResult */

// private, chrome.storage.local의 videoState 한 키로 원자 교체
// StoreEnvelope = {schema:1, revision, videos, receipts, undo}
// receipt = {operationId, expiresAt, resultWithoutSnapshot}
// undo = {token, expiresAt, rows:[{video, originalIndex}]}

/** @typedef {{host:string, id:string, accountRoute:string, url:string,
 * title:string, windowId:number, tabId:number}} Notebook */
/** @typedef {{code:'rate_limit'|'timeout'|'network'|'schema'|'context'|'auth'|'empty',
 * message:string, retryAt?:number}} ReadError */
/** @typedef {{text:string, extractedAt:number}} SuccessfulText */
/** @typedef {{kind:'never'} | {kind:'loading',startedAt:number} |
 * {kind:'success',finishedAt:number} |
 * {kind:'failed',finishedAt:number,error:ReadError} |
 * {kind:'cancelled',finishedAt:number}} Attempt */
/** @typedef {{type:'source',id:string,title:string,url:string,channel:string,
 * kind:string,selected:boolean,lastSuccess:SuccessfulText|null,attempt:Attempt} |
 * {type:'omission',key:string,title:string,selected:boolean,rowIndex:number,
 * reason:string}} SourceRow */
/** @typedef {{notebook:Notebook,rows:SourceRow[],rawCount:number}} SourceListing */
/** @typedef {{id:string,contextKey:string,cancelled:boolean,
 * phase:'running'|'cooldown'|'draining',retryAt:number|null}} Job */
```

`accountRoute`는 페이지에서 실제 선택한 숫자 `authuser`이며 없으면 명시적 `default`다. 쿠키·토큰·WIZ 원문·이메일을 포함하지 않는다. 노트북 비교 키는 host+id+accountRoute이며 복구에는 windowId까지 포함한다. 숫자 계정 경로는 영구 계정 ID가 아니라는 제한을 복구 정책에서 보완한다.

## 모듈 지도와 공개 계약

새 production 파일은 `extension/video-store.js` 하나만 둔다.

| 파일 | 책임 / 함수 |
| --- | --- |
| `video-store.js` 새 파일 | `connectVideos(api,onSnapshot) -> {ready,command,dispose}`; `createVideoCommandHandler(storage) -> async (request) => reply`. 저장 schema, command validation, 직렬 queue, migration, reducer, receipt·undo 정책을 내부 소유 |
| `background.js` | module worker로 전환, 위 handler 생성, top-level runtime listener 즉시 등록, sender 검증과 sendResponse. 기존 sidePanel 설정 유지 |
| `core.js` | `mergeVideos(existing,incoming,limit=500)`, `filterVideos(videos,query)`, `composeMarkdown(notebook,rows,date)`. URL·제목 정규화, placeholder enrichment, export 정책의 유일한 소유자 |
| `page-actions.js` | `collectYouTube({scroll,expectedRoute})`, `readNotebook({operation,expectedContext,sourceId})`; 주입 함수 내부 의존성 유지, 외부 결과를 domain 자료로 파싱 |
| `panel.js` | 영상 명령 호출·렌더, current-window notebook picker, 검색, 메모리 SourceRow, 취소/429 queue. `extractSources(mode)`, `loadSources(target)`, `refreshNotebookChoices()`, `acceptVideoSnapshot(snapshot)` |
| `panel.html/css` | 검색, 선택 삭제·undo, fresh/retry, notebook picker, omission·이전 본문 경고, 선택적 복구 UI |
| `tools/mock-chrome.js` | production video handler를 사용하는 runtime/storage 이벤트 mock; UI용 직접 배열 쓰기 지름길 금지 |

`manifest.json` 변경은 background에 `type:'module'`만 추가한다. 기존 permissions·host_permissions는 그대로 둔다. public command API에는 operationId, 저장 키, storage schema, Chrome event가 노출되지 않는다. adapter가 이를 숨긴다. 주입 함수의 직렬화 특성 때문에 필요한 문맥 정규화 몇 줄은 내부에 있어야 하며, 공통 계약 fixture로 일치 검증한다.

## 영상 저장 명령의 불변식과 의사 코드

1. `videoState`의 유일한 writer는 background handler다. `persistVideos`, panel의 local.set, panel 자체 저장 queue를 같은 변경에서 제거한다. 소스 본문은 여기에 절대 넣지 않는다.
2. 모든 명령은 정규 URL로 검증되고 대상 배열은 중복 제거된다. 선택·삭제는 명시 URL에만 적용되며 없는 URL은 no-op. 같은 URL에 대한 충돌은 worker 처리 순서대로 적용된다. 서로 다른 URL 변경은 유실되지 않는다.
3. 기존 순서와 선택을 보존하고 500개 초과 신규 추가만 거절한다. 빈 채널·URL과 동일한 제목만 새 비어 있지 않은 metadata로 채운다. 이미 의미 있는 제목은 덮어쓰지 않는다. `enrich`는 존재하는 영상만 바꾸므로 삭제한 항목을 부활시키지 않는다.
4. delete는 실제 삭제한 행만 undo에 저장한다. undo는 현재 없는 URL만 원래 순서에 가깝게 복원하고 현재 목록을 절대로 교체하지 않는다. 용량만큼 복원하며 나머지는 명시 skipped 반환. 한 번 소비한 token은 다시 사용 불가다. 새 add가 해당 URL을 다시 만들면 예전 undo의 같은 URL을 무효화해 나중 삭제를 과거 undo가 뒤집지 못한다. 최대 20개 batch·5분, 만료된 행부터 정리한다.
5. `operationId`는 클라이언트가 1회 생성하고 응답 유실 재전송에서도 재사용한다. receipt와 결과 상태는 같은 set에 기록한다. receipt는 10분 보관, 최대 512개다. 만료/초과로 밀린 요청을 중복 실행하지 않도록 request에 issuedAt을 두고 receipt 보관 하한보다 오래된 요청은 `expired`로 거절한다. 초과 정리 시 evictionFloor를 같은 envelope에 저장한다. client는 자동 재전송 1회만 하며 expired면 최신 snapshot을 읽고 사용자에게 결과 확인을 안내한다.
6. 저장 성공 전 snapshot/revision/성공 응답을 공개하지 않는다. 실패하면 명령은 실패하고 기존 상태를 유지한다. 다시 읽어 실제 commit 여부와 receipt를 확인한 후 재전송한다.

```js
// background module 평가 중 동기적으로 등록; init await 다음에 등록하지 않는다.
const handle = createVideoCommandHandler(chrome.storage.local);
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isOwnPanelSender(sender) || !isVideoRequest(request)) return false;
  handle(request).then(sendResponse, error => sendResponse(toFailure(error)));
  return true; // 비동기 응답 채널 유지
});

// handler 내부; 네트워크 호출/긴 타이머 없음
queue = queue.catch(() => {}).then(async () => {
  current = await readOrMigrate();
  // snapshot 요청도 같은 queue; migration과 race하지 않음
  if (isSnapshotRequest(request)) return publicSnapshot(current);
  if (hasReceipt(current, request.operationId)) return receiptWithLatestSnapshot();
  validateNotExpired(request, current.evictionFloor);
  next = reduceCommand(current, request.command); // bounded pure transition
  next.revision = current.revision + 1;
  next = attachReceiptAndPrune(next, request);
  await local.set({videoState: next});
  return publicResult(next);
});
```

MV3 재시작 시 queue는 새로 시작하지만 authoritative state와 receipt는 disk에서 다시 읽는다. 확장의 단일 service worker 실행 모델을 사용하며 매 작업이 짧고 listener가 응답까지 유지된다. worker가 commit 후 응답 전에 종료돼도 동일 operationId의 재시도는 중복 delete/undo를 만들지 않는다. migration은 `videoState`가 없을 때 기존 `videos`를 `mergeVideos`로 정규화해 같은 선택·순서로 옮긴다. 새 set 성공 후에만 legacy key를 제거하고, 새 key가 있으면 legacy를 다시 가져오지 않는다. 제거 중 종료되어도 새 key가 우선이다.

클라이언트는 **storage.onChanged 구독을 먼저 설치한 뒤 snapshot을 요청**한다. event와 reply는 공통 accept 함수에서 `incoming.revision > displayed.revision`일 때만 반영한다. 느린 command reply가 최신 event를 되돌리지 못한다. optimistic 배열 변경은 하지 않고 해당 조작에 pending 표시만 한다. 같은 패널 명령도 입력 순서 queue로 보내지만 다른 패널은 독립 동작한다. client를 dispose할 때 listener를 해제한다.

수집은 매 round의 새 URL만 한 번 add하고 같은 URL 재발견은 enrich한다. 시작 시 페이지 identity를 고정한다. search는 pathname+search_query+sp, channel은 pathname, playlist는 list, single은 v로 identity를 구성한다. 매 주입은 DOM 읽기/스크롤 **전에** expectedRoute와 location을 비교하고 응답에도 identity를 넣는다. 패널은 결과 처리 전에 tabs.get으로 다시 비교한다. 이동 감지 시 그 batch를 버리고 수집을 중단한다. 이전에 추가한 영상은 유지한다. YouTube SPA 전환 중 DOM 준비가 불명확하면 해당 round를 수락하지 않는다. 처음으로 관찰한 신규 add와 다른 패널 delete가 경쟁하면 worker 순서가 의미이며, 이후 반복 round로 자동 재추가하지 않는다.

## 본문·누락·재추출 계약

`readNotebook`는 RPC의 row마다 `SourceRow`를 만든다. source ID 없는 행, duplicate ID, 잘못된 구조는 index 기반 omission으로 남긴다. 제목·URL 등 안전한 표시 정보만 보존하고 원본 RPC blob은 저장하지 않는다. 정상 목록 container가 없으면 전체 `schema` 오류지만, 모든 행이 omission이어도 유효한 누락 목록으로 반환한다. `rawCount === rows.length`를 보장한다. omission은 선택/해제·export 가능하고 본문 요청 대상이 될 수 없다.

목록 재조회는 host+id+accountRoute가 같은 경우에만 같은 정상 source ID의 selection과 lastSuccess/attempt를 보존한다. 요청 시작/종료 때 context를 확인하며, 목록 변경 시 panel generation을 증가시켜 예전 reply를 무시한다. context가 바뀌면 이전 본문을 새 notebook에 합치지 않는다.

`lastSuccess`는 성공한 비어 있지 않은 본문에서만 교체한다. 실패·취소·새 목록 조회·loading 전이는 지우지 않는다. `fresh`는 모든 선택 정상 row, `retry`는 lastSuccess가 없거나 최근 attempt가 failed/cancelled인 row를 선택한다. UI 상태는 lastSuccess 유무와 attempt를 함께 렌더한다. fresh 실패에는 ‘이전 성공 본문 사용 · [시각] · 최신 추출 실패’를 표시한다. 목록 조회만으로 ‘최신’임을 주장하지 않는다.

`composeMarkdown`는 선택 row에 lastSuccess가 있으면 attempt와 무관하게 본문을 내보내고, 최근 attempt가 성공이 아니면 이전 본문 사용 경고를 붙인다. lastSuccess 없는 정상 row와 omission은 누락 목록에 포함한다. 선택 row가 있으면 누락만 있어도 export를 활성화한다. 전체 목록 수·선택 수·본문 포함 수·누락 수와 추출 시각을 표시한다.

## 429와 중지

page-action wire 응답은 기존 `{error:message}`에 `code`, `retryAt`을 추가해 기존 오류 테스트를 살릴 수 있다. `runInTab`에서 message만 Error로 바꾸지 않고 ReadError 정보를 유지한다. HTTP Retry-After의 초/HTTP-date를 파싱하며 invalid이면 fallback을 쓴다. 인증과 문맥 불일치도 종류를 보존한다.

추출 동시성 3은 유지한다. worker loop는 dequeue 직전에 job identity, cancelled, retryAt을 모두 확인한다. 첫 429가 오면 즉시 shared phase를 cooldown으로 바꾸고 더 이상 시작하지 않는다. 이미 시작한 최대 2개는 동일 문맥일 때 결과를 반영한다. 기본 대기는 30초, 연속 429에서 60·120·240·300초, 서버 retryAt이 더 늦으면 이를 우선한다. **자동 재개하지 않고** 남은 요청 수와 재개 가능 시각을 표시한다. 사용자가 재시도해야 새 작업을 시작한다. cooldown은 notebook context별 panel 메모리에 남아 중지 후 즉시 재시도로 우회되지 않는다.

중지는 queued 작업과 대기 타이머를 즉시 취소한다. 이미 주입한 요청은 AbortController를 패널로 전송할 수 없으므로 기존 25초 timeout 안에 정리되는 draining 방식을 사용하고 UI에 명시한다. 이 상태에서도 중복 job은 시작하지 않는다. 패널 종료 시 큐는 사라지고, 늦은 응답은 generation/job 체크로 무시된다. 서비스 worker에 본문 작업을 옮기거나 무한 생존을 기대하지 않는다.

## 노트북 대상과 선택적 임시 복구

currentWindow 전체 tabs에서 `pageKind === notebook`인 탭을 제목·계정 경로·호스트와 함께 표시한다. active notebook을 최초 기본값으로 선택하며, 사용자 선택 이후 active tab 변경으로 선택을 바꾸지 않는다. load와 handoff는 같은 선택 tabId를 사용하고 실행 직전 tab 존재/URL identity를 다시 검증한다. 같은 notebook의 복수 탭은 탭별 표시한다. 후보가 없을 때만 기존 notebook home 열기를 사용한다. 계정 query를 보존하고 다른 창 탭은 사용하지 않는다.

임시 본문 복구는 **기본 OFF**이며 이번 변경에서 구현하지 않아도 핵심 기능이 완결된다. 구현한다면 다음 계약을 모두 지킨다.

- 사용자 명시 opt-in 후 `chrome.storage.session`만 사용한다. local/sync/sessionStorage/파일에는 본문을 쓰지 않는다. 옵션 자체의 boolean만 local에 둘 수 있다.
- windowId+host+notebookId+accountRoute 키, source ID별 마지막 성공 본문·성공 시각만 whitelist 저장한다. 인증 토큰·쿠키·WIZ 정보·RPC 요청/응답 원문·email은 금지한다.
- 현재 창 세션 최대 3 notebooks, 전체 UTF-8 JSON 2 MiB, 30분 TTL. quota 초과는 오래된 entry부터 evict하고 알려 준다. row text를 조용히 절단하지 않는다.
- 복구는 같은 context의 새 list 성공과 source ID 대조 후 별도 ‘임시 본문 복원’ 조작으로만 수행한다. 계정 경로는 영구 계정 식별자가 아니므로 자동 복원하지 않는다. 계정 문맥을 확정 못하면 복구를 하지 않는다.
- ‘이 노트북 임시 본문 삭제’, ‘모두 삭제’, OFF 시 전체 삭제를 제공한다. 진행 중 저장이 삭제 후 다시 생성하지 않도록 generation을 증가시켜 stale save를 버린다. window 종료 시 해당 entry 정리, 브라우저 재시작 시 session API의 소멸 정책을 따른다.
- 저장 실패는 추출 성공을 실패로 바꾸지 않는다. opt-in 복구가 없어도 패널 메모리 및 export는 정상 동작한다.

## 검증과 합성 결정

권고 기반은 A다. B의 장점인 독립 변경 단위만 domain command로 가져오고, 물리 분산 기록과 read-time 합성은 도입하지 않는다. 경계 규칙은 한 모듈이 소유하므로 호출자가 merge·write·undo 순서를 조립하지 않는다. 독립 loader/saver/repository wrapper나 범용 queue framework를 추가하지 않는다. worker 왕복 한 번과 envelope 쓰기를 받아들여 500개/삭제/선택의 단일 의미를 얻는다.

검증은 다음 행동을 고정한다.

- 두 client의 겹친 add/select/delete 및 499개에서 동시 add: 유실 없음, 500개 유지, 서로 다른 항목 선택 보존.
- 늦은 reply보다 먼저 온 최신 event, 최초 snapshot 중 event, worker 재생성, 저장 후 응답 유실 재전송, migration 중 재시작.
- undo가 다른 패널 추가·선택을 바꾸지 않음; 재추가 후 재삭제를 오래된 undo가 부활시키지 않음; full capacity partial undo 안내.
- placeholder metadata만 보강; enrichment가 삭제 URL을 생성하지 않음; route 변경 round가 추가·스크롤하지 않음.
- fresh 성공→실패 시 기존 본문과 경고 export; retry/fresh 대상 차이; numeric paragraphs 보존; omission-only 목록 export.
- 429 이후 새 요청 시작 없음, 서버 cooldown 우선, cancel 시 대기 타이머 취소, in-flight 결과 문맥 검증.
- picker가 inactive 같은 창 notebook을 사용하고 다른 창/닫힌 탭을 제외함.
- optional 복구를 구현할 경우 OFF 상태 write 0, window/account 격리, expiry/quota/clear, token 문자열 미저장.

`npm test`와 `npm run check`를 실행한다. mock adapter에는 runtime.sendMessage/onMessage, storage.onChanged, tabs.get/query filters와 여러 panel을 공유하는 storage를 추가해 실제 handler를 통과시킨다. mock은 MV3 종료를 증명하지 못하므로 실제 unpacked 확장의 두 패널 및 worker restart 검증을 별도 기록해야 한다. 실제 Notebook RPC 계약은 mock 성공만으로 검증 완료라고 하지 않는다.

첫 구현 단위는 `video-store.js`와 background listener, legacy migration 및 두 client 동시성 테스트다. 이후 panel 영상 호출부를 한 번에 이전하고 본문·큐·picker를 붙인다. 저장 의미에 대한 추가 설계 분기는 필요 없다.
