# Technical Debt Register

| ID | Item | Why accepted | Cost if left | Pay down when |
|---|---|---|---|---|
| TD-01 | In-app identity instead of OIDC IdP (E-ADR-02) | hardware | security ownership | before production |
| TD-02 | Audit store is a schema, not a separate database (E-ADR-05) | one local instance | weaker separation | hosted cell |
| TD-03 | Local-disk FileStore (E-ADR-13) | no object store locally | not multi-node | hosted cell |
| TD-04 | No OpenTelemetry, no CI pipeline yet | scope | observability | before B4 |
