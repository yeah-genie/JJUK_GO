# GitHub에서 Codex에 작업 맡기기

2026-10-29 연결 확인.

`yeah-genie/JJUK_GO`가 코드리뷰 저장소 목록에 나타나며, [저장소 설정](https://chatgpt.com/settings/code-review/repositories/github-1360819876)에서 자동 리뷰가 켜져 있다. 리뷰 대상·트리거·철저한검토는 개인 설정을 따른다. 기존 개인 설정은 자동검토ON/PR이열릴때/철저한검토ON/추가크레딧OFF였으며 이번 연결 확인에서 변경하지 않았다.

설정 화면은 로컬 확인용으로 보관하며 공개 저장소에 업로드하지 않는다.

## PR에서 사용

- 검토 요청 댓글: `@codex review`
- 수정 요청 예시: `@codex fix the CI failures`
- 쭉고 작업 맥락을 줄 때: `@codex docs/HANDOFF.md와 최신 docs/discussions 기록을 먼저 읽고, 이 PR의 문제를 수정해. 기존 디자인은 유지하고 검증 결과도 Markdown으로 기록해.`

[OpenAI 공식 GitHub 안내](https://learn.chatgpt.com/docs/third-party/github)에 따르면 review 외 요청은 PR을 맥락으로 레거시 클라우드 작업을 시작하고, 필요한 권한이 있으면 수정사항을 브랜치에 올릴 수 있다. 실제 요청에 대한 반응·로그·수정 결과는 별도로 확인한다. 이슈 댓글에서도 동일하게 실행되는지는 이번 공식 문서와 설정 확인만으로 검증하지 않았다.

## 확인 범위

GitHub 앱/저장소의 연결과 리뷰 활성화 상태를 확인했다. 테스트 댓글을 게시하거나 유료 리뷰·수정 작업을 실행하지 않았다. 이 로컬 대화가 GitHub 작업에 자동 복사되는 것은 아니므로 저장소의 AGENTS.md, HANDOFF.md, discussions 기록을 사용한다. API 키나 별도 GitHub Actions 에이전트 워크플로를 추가하지 않았다.
