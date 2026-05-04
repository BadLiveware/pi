# Sources

This corpus and prompt pack were derived from:
- `agent/skills/review/SKILL.md`
- `agent/skills/review/validation-scenarios.md`
- empirical, benchmark, and practical sources listed below

## External sources

- Bacchelli, A., & Bird, C. *Expectations, Outcomes, and Challenges of Modern Code Review* (ICSE 2013)
  https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/?from=research.microsoft.com/apps/pubs/default.aspx?id=180283&type=exact
- Sami, A. et al. *Which bugs are missed in code reviews: An empirical study on SmartSHARK dataset* (2022), arXiv:2205.09428
  https://arxiv.org/abs/2205.09428
- Khan, T. I. et al. *A Survey of Code Review Benchmarks and Evaluation Practices in Pre-LLM and LLM Era* (2026), arXiv:2602.13377
  https://arxiv.org/abs/2602.13377
- Pereira, K. et al. *CR-Bench: Evaluating the Real-World Utility of AI Code Review Agents* (2026), arXiv:2603.11078
  https://arxiv.org/html/2603.11078v1
- *Code Review Agent Benchmark* / c-CRAB (2026), arXiv:2603.23448
  https://arxiv.org/html/2603.23448v2
- Cloudflare. *Orchestrating AI Code Review at scale* (2026)
  https://blog.cloudflare.com/ai-code-review/
- Anonymous. *Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?* (2026)
  https://openreview.net/forum?id=8V5bfIAyBb
- Chen, L. et al. *Leveraging Test Plan Quality to Improve Code Review Efficacy* (ESEC/FSE 2022)
  https://2022.esec-fse.org/details/fse-2022-industry/14/Leveraging-Test-Plan-Quality-to-Improve-Code-Review-Efficacy
- Davila, N. et al. *A fine-grained taxonomy of code review feedback in TypeScript projects* (2025)
  https://link.springer.com/article/10.1007/s10664-024-10604-y
- *Hold on! is my feedback useful? Evaluating the usefulness of code review comments* (2025)
  https://link.springer.com/article/10.1007/s10664-025-10617-1
- Turzo, A. K., & Bosu, A. *What makes a code review useful to OpenDev developers? An empirical investigation* (2024)
  https://link.springer.com/article/10.1007/s10664-023-10411-x
- SonarSource. *What is automated code review?*
  https://www.sonarsource.com/resources/library/what-is-automated-code-review/

## Practical heuristic examples

Used only for config / schema / migration support:
- https://github.com/github/gh-aw/issues/10098
- https://github.com/apache/airflow/pull/64972

## Family-to-source mapping

| Family | Primary evidence basis |
|---|---|
| semantic-logic | Sami et al. (SmartSHARK missed-bug taxonomy); Bacchelli & Bird |
| contract-drift | CR-Bench; Khan et al.; Cloudflare |
| incomplete-propagation | Khan et al.; CR-Bench; Cloudflare |
| error-path | c-CRAB; CR-Bench; Cloudflare |
| state-lifecycle | Sami et al.; Bacchelli & Bird |
| test-gap | Chen et al. (test plan quality); Khan et al. |
| build-compatibility | Sami et al.; SonarSource |
| config-schema | gh-aw issue 10098; airflow PR 64972; Cloudflare |
| security-boundary | Sami et al.; SonarSource |
| concurrency | Sami et al.; Cloudflare |
| design-docs | c-CRAB; Davila et al.; Cloudflare |
| review-process | Bacchelli & Bird; CR-Bench; Cloudflare; AGENTS.md eval |
