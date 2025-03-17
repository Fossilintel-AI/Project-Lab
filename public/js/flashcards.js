document.addEventListener("DOMContentLoaded", async () => {
    const card = document.getElementById("card");
    const nextBtn = document.getElementById("next");
    const prevBtn = document.getElementById("prev");
    let flashcards = [];
    let currentIndex = 0;

    // Fetch flashcards from the backend
    async function fetchFlashcards() {
        const response = await fetch("/getFlashcards");
        if (response.ok) {
            flashcards = await response.json();
            console.log("Received flashcards:", flashcards);
            setTimeout(() => {
                showFlashcard();
            }, 500); // Delay before displaying the first card
        } else {
            card.textContent = "No flashcards available.";
        }
    }

    function showFlashcard() {
        if (flashcards.length > 0) {
            card.classList.remove("flipped"); // Reset flip
            const flashcard = flashcards[currentIndex];
            card.querySelector(".question p").textContent = flashcard.question;
            card.querySelector(".answer p").textContent = flashcard.answer;
        }
    }

    card.addEventListener("click", () => {
        card.classList.toggle("flipped");
    });

    nextBtn.addEventListener("click", () => {
        if (currentIndex < flashcards.length - 1) {
            currentIndex++;
            showFlashcard();
        }
    });

    prevBtn.addEventListener("click", () => {
        if (currentIndex > 0) {
            currentIndex--;
            showFlashcard();
        }
    });

    await fetchFlashcards();
});
