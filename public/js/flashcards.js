document.addEventListener("DOMContentLoaded", async () => {
    const card = document.getElementById("card");
    const nextBtn = document.getElementById("next");
    const prevBtn = document.getElementById("prev");

    let flashcards = [];
    let currentIndex = 0;
    let showAnswer = false;

    // Fetch flashcards from the backend
    async function fetchFlashcards() {
        const response = await fetch("/getFlashcards");
        if (response.ok) {
            flashcards = await response.json();
            showFlashcard();
        } else {
            card.textContent = "No flashcards available.";
        }
    }

    function showFlashcard() {
        if (flashcards.length > 0) {
            card.textContent = showAnswer
                ? flashcards[currentIndex].answer
                : flashcards[currentIndex].question;
        }
    }

    card.addEventListener("click", () => {
        showAnswer = !showAnswer;
        showFlashcard();
    });

    nextBtn.addEventListener("click", () => {
        if (currentIndex < flashcards.length - 1) {
            currentIndex++;
            showAnswer = false;
            showFlashcard();
        }
    });

    prevBtn.addEventListener("click", () => {
        if (currentIndex > 0) {
            currentIndex--;
            showAnswer = false;
            showFlashcard();
        }
    });

    fetchFlashcards();
});
