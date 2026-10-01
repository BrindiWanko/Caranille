-- Quest objectives: counters of the current step (talk / kill / reach
-- objectives), as a JSON array indexed like the step's objectives.
ALTER TABLE character_quests ADD COLUMN counters TEXT NOT NULL DEFAULT '[]';
