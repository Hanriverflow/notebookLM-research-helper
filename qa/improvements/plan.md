# 리서치 포켓 개선 작업

## 작업 순서

- [x] 1. `how` over the affected subsystem.
- [x] 2. `architect` for parallel design exploration.
- [x] 3. Write the throughput checkpoint as four todo items.
- [x] 4. Delegate code-writing to a subagent using your configured feature model.
- [ ] 5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it. 실제 설치·변경 후 화면·실계정은 미검증이다. 브라우저 URL 확인 실패로 자동 제어가 중단됐다. 로컬 동작 테스트 42개와 패키지 검사는 통과했다.
- [x] 6. Rebase into small, ordered commits. Stack follow-ups. skip: Git 저장소와 기존 커밋이 없어 로컬 파일로 전달한다.
- [x] 7. If the design is contested, `interrogate` before shipping. skip: 두 설계안과 별도 검토가 같은 저장 구조를 선택했고 남은 설계 충돌이 없다.
- [x] 8. Run **Opening a PR**. skip: 연결된 저장소와 원격 주소가 없다.

## 처리 순서와 소유권

- Blocking first steps. 기존 구조와 두 설계안을 확인한 뒤 구현한다. 변경 전 파일은 별도 임시 폴더에 보관한다.
- Independent workstreams. 구현 담당자는 확장 코드와 테스트를 소유한다. 주 담당자는 브라우저 검증 도구와 검증 기록을 소유한다.
- Shared mutable state. 여러 패널에서 함께 쓰는 영상 목록은 추가, 선택, 삭제가 서로 덮어쓰지 않아야 한다. 단일 작성자와 항목별 저장을 비교한다.
- Smallest safe decomposition. 함수 사이 계약을 바꾸는 코드는 한 담당자가 통합한다. 같은 소스 파일을 여러 담당자가 동시에 수정하지 않는다.

## 설계 검토

- Architect. Ground, Sketch, Agree, Implement, Scrap.
- Arena. Frame, Fan out, Cross-judge, Pick, Graft, Verify.
- 설계안은 서로 다른 폴더에 작성한다. 주 담당자와 별도 검토자가 비교한다.

## 완료 조건

- 여러 패널의 영상 추가, 선택, 삭제를 안전하게 저장한다.
- 최신 본문 재추출과 실패 항목 재시도를 구분한다.
- 해석하지 못한 소스와 이전 본문을 사용하는 항목을 화면과 저장 파일에 표시한다.
- 요청 제한 시 대기 작업을 멈추고 복구 방법을 안내한다.
- 수집 중 페이지가 바뀌면 다른 페이지의 영상을 추가하지 않는다.
- 직접 입력한 링크의 제목과 채널 정보를 나중에 채운다.
- 목록 검색, 선택 삭제와 되돌리기, 대상 노트북 선택을 제공한다.
- 패널 종료 후 본문 복구는 이번 범위에서 제외한다. 로그인 순번만으로 계정 전환을 식별하지 못한다. 같은 패널의 재추출 실패 시 마지막 성공 본문은 보존한다.
- 단위 테스트, 패키지 검사, 브라우저 UI 검증 결과와 미검증 범위를 남긴다.

## 기준 상태

- 2026-11-08 기존 테스트 12개 통과와 패키지 검사 통과를 확인했다.
- 이전 분석에서 모의 환경으로 여섯 문제를 재현했다.
- 실제 사용자 노트북에 대한 요청은 아직 수행하지 않았다.

## 전달 결과

- production 구현 담당자는 확장 코드와 테스트를 완료했다. 주 담당자는 소스를 직접 검토하고 검증 도구·기록·배포 ZIP을 완료했다.
- 실제 패널 코드를 실행한 모의 DOM 검사 14개를 포함해 동작 테스트 42개가 통과했다.
- `verify-local.mjs`가 1.1.0 ZIP의 15개 파일을 현재 소스와 비교했고 모두 일치했다.
- 검증 5단계의 실제 브라우저 부분은 미완료로 남긴다. 전체 결과는 `../../VALIDATION.md`에 기록했다.
