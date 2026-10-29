# JJUK_GO 협업 규칙

## 대화와 결정의 GitHub 기록

사용자 요청(2026-10-28): **사용자와 논의한 프로젝트 내용을 빠짐없이 Markdown으로 GitHub에 남겨, 이후 Claude도 이어서 작업할 수 있게 한다.**

- 작업 시작 시 `docs/HANDOFF.md`와 최신 `docs/discussions/` 기록을 읽는다.
- 매 작업 종료 전에 요구사항, 결정, 제안, 구현, 검증 결과, 미완료 사항을 Markdown에 기록한다. 중요하게 방향이 바뀌면 중간에도 기록한다.
- 사용자가 승인한 결정과 에이전트의 제안을 구분한다. 검증하지 않은 내용이나 설치·배포·머지하지 않은 것을 완료로 쓰지 않는다.
- 날짜별 대화 기록은 `docs/discussions/YYYY-MM-DD.md`에 누적하고, 현재 상태와 다음 작업은 `docs/HANDOFF.md`에 갱신한다.
- 프로젝트 관련 질문·답변, 선호, 실패한 시도와 그 영향도 다음 작업자가 이해하는 데 필요한 만큼 보존한다. 자격 증명·토큰·비밀정보는 기록하지 않는다.
- 변경 문서는 현재 작업 브랜치에 커밋하고 GitHub에 push한다. push가 실패하면 로컬 기록을 유지하고 미동기화 사실과 이유를 사용자에게 알린다.
- 기본 브랜치 merge와 서비스 배포는 별도 작업이다. 문서 업로드만으로 merge·배포가 완료되었다고 쓰지 않는다.

## 프로젝트 실행

- 프로토타입 소스: `docs/prototype/src/template.html`, `docs/prototype/src/app.js`.
- 소스 수정 후 `python scripts/build_prototype.py`로 `docs/prototype/index.html`을 생성한다.
- 실행 데이터는 `docs/prototype/seoul/`에 포함되어 있다. ZIP은 추가하지 않는다.
- 실행: `python -m http.server 8766 --bind 127.0.0.1 --directory docs/prototype`.
- 테스트: `.venv/Scripts/python.exe -m pytest -q`; UI 검사: `node scripts/check_prototype_ui.cjs`(Playwright 필요).
