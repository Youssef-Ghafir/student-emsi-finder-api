function normalizeName(name) {
  return name
    .toUpperCase()
    .normalize("NFD")                 // remove accents
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’\-]/g, " ")          // apostrophes & hyphens
    .replace(/[^A-Z\s]/g, "")         // keep letters only
    .replace(/\s+/g, " ")
    .trim();
}
function tokenize(name) {
  return normalizeName(name).split(" ");
}
function nameScore(inputTokens, candidateTokens) {
  let score = 0;

  for (const token of inputTokens) {
    if (candidateTokens.includes(token)) {
      score += 1;
    }
  }

  return score / Math.max(inputTokens.length, candidateTokens.length);
}

function normalizeFilename(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function findStudentByName(students, inputName, minScore = 0.6) {
  const inputTokens = tokenize(inputName);

  let bestMatch = null;
  let bestScore = 0;

  for (const student of students) {
    const studentTokens = tokenize(student.name);
    const score = nameScore(inputTokens, studentTokens);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = student;
    }
  }

  if (bestScore >= minScore) {
    return {
      match: bestMatch,
      confidence: Number(bestScore.toFixed(2)),
    };
  }

  return null;
}
module.exports = { normalizeFilename, findStudentByName };