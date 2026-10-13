CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, model TEXT, billing_provider TEXT, started_at REAL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, api_call_count INTEGER);
INSERT INTO sessions VALUES ('h1','cli','claude-sonnet-4-5','anthropic',1790000000.5,6000,2000,80000,9000,300,12);
INSERT INTO sessions VALUES ('h2','cli',NULL,NULL,1790000000.5,1,1,0,0,0,1);
