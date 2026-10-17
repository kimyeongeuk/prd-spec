---
name: update
description: 이미 쓴 PRD·기능명세서를 회신·결정 변경·구현 차이에 맞춰 갱신한다(prd-spec 모드 B).
argument-hint: "[회신 파일 · 바뀐 결정 · 구현 차이]"
disable-model-invocation: true
---

Skill 도구로 `prd-spec:prd-spec`을 불러 **모드 B(갱신)**로 진행한다. 받은 인자는 B-1 "무엇이 바뀌었나"의 입력이다. 이 스킬 형식(ID 체계 · 미확정 표)의 기준 문서가 없으면 갱신하지 않고, 모드 A가 맞다고 알린 뒤 사용자에게 묻는다.
