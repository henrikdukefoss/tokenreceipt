CREATE TABLE `session` (`id` text PRIMARY KEY, `project_id` text, `directory` text NOT NULL, `time_created` integer NOT NULL);
CREATE TABLE `message` (`id` text PRIMARY KEY, `session_id` text NOT NULL, `time_created` integer NOT NULL, `time_updated` integer NOT NULL, `data` text NOT NULL);
INSERT INTO session VALUES ('ses_a','p1','/work/alpha',1758600000000);
INSERT INTO session VALUES ('ses_b','p2','/work/beta',1758600000000);
INSERT INTO message VALUES ('m_a1','ses_a',1758600000000,1758600000000,'{"role":"assistant","modelID":"gpt-5","providerID":"openai","time":{"created":1758600000000},"path":{"cwd":"/work/alpha/packages/web","root":"/work/alpha"},"tokens":{"input":1000,"output":100,"reasoning":0,"cache":{"read":0,"write":0}}}');
INSERT INTO message VALUES ('m_a2','ses_a',1758600100000,1758600100000,'{"role":"assistant","modelID":"gpt-5","providerID":"openai","time":{"created":1758600100000},"tokens":{"input":200,"output":20,"reasoning":0,"cache":{"read":0,"write":0}}}');
INSERT INTO message VALUES ('m_b1','ses_b',1758600200000,1758600200000,'{"role":"assistant","modelID":"gpt-5","providerID":"openai","time":{"created":1758600200000},"tokens":{"input":5000,"output":500,"reasoning":0,"cache":{"read":0,"write":0}}}');
INSERT INTO message VALUES ('m_x1','ses_gone',1758600300000,1758600300000,'{"role":"assistant","modelID":"gpt-5","providerID":"openai","time":{"created":1758600300000},"tokens":{"input":70,"output":7,"reasoning":0,"cache":{"read":0,"write":0}}}');
