
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt, {hash} from "bcrypt";
import fs from "fs";
import  path from "path";
import multer from "multer"

//use for path finding
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

//convert pdf to text and cohere
import { CohereClientV2 } from 'cohere-ai'; // Import Cohere's SDK
import pdfParse from 'pdf-parse';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
// Serve static files from Workstation directory
app.use('/Workstation', express.static(path.join(__dirname, 'Workstation')));

//encryption
const saltRounds = 10;
global.user_id = 0;
global.currentSubject = null;



// Set storage engine for Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!global.user_id || !global.currentSubject) {
            return cb(new Error("User ID or Subject is missing"));
        }

        const dir = path.join(__dirname, `./Workstation/${global.user_id}/${global.currentSubject}/slides`);

        // Create directory if it doesn't exist
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
// Initialize upload middleware
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit to 5MB
    fileFilter: (req, file, cb) => {
        const fileTypes = /pdf/;
        const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = fileTypes.test(file.mimetype);

        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed!"));
        }
    }
});


//database
const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "website",
    password: "Mankael123456",
    port: 5432,
});
db.connect((err) => {
    if (err) {
        console.error("Failed to connect to the database:", err.stack);
    } else {
        console.log("Connected to the database.");
    }
});

//for To-do List
let items = [
];

//Time table useful variables and function
let timetable = [
];
const subjectColors = {};
const predefinedColors = [
    "#ffcc00", "#ff5733", "#28a745", "#17a2b8", "#6610f2",
    "#e83e8c", "#6f42c1", "#fd7e14", "#20c997", "#dc3545"
];
function getSubjectColor(subject) {
    if (!subjectColors[subject]) {
        const hash = [...subject].reduce((acc, char) => acc + char.charCodeAt(0), 0);
        subjectColors[subject] = predefinedColors[hash % predefinedColors.length];
    }
    return subjectColors[subject];
}


//LLM Cohere and Questions Generation
// Initialize Cohere client with your API key
const cohere = new CohereClientV2({
    token: 'SWaeBAPGPwj2ClLJ3ToDPqipg6sVGNvfCIrLDo9p', // Your Cohere API key
});

// Function to extract text from PDF
async function extractTextFromPDF(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        return pdfData.text;
    } catch (error) {
        console.error('Error parsing PDF:', error);
        throw error;
    }
}

// Function to generate questions using Cohere
async function generateQuestions(text) {
    try {
        // const prompt = `Based on the following text, generate a set of questions and Answers Text in the form as key: value pair object {dont include question and answer tags ,let the answer start with ***}:\n\nText: ${text}`;
        const prompt = `Based on the following text, generate a set of questions and answers in the form of key-value pairs as an array of objects. Each object should contain a "question" and an "answer" field, return the array no words above it and please dont add "" on the array start and end, no newline. The output should look like this:

[
  { "question": "What is an apple?", "answer": "A fruit" },
  { "question": "What is 2 + 2?", "answer": "4" },
  { "question": "Who discovered gravity?", "answer": "Isaac Newton" }
]

Text:${text}
`;

        const response = await cohere.chat({
            model: 'command-r-plus',
            messages: [
                { role: 'user', content: prompt }
            ]
        });

        if (response.message && Array.isArray(response.message.content) && response.message.content[0].text) {
            const generatedText = response.message.content[0].text.trim();
            return generatedText;
        } else {
            throw new Error('Unexpected response structure');
        }
    } catch (error) {
        console.error('Error generating questions:', error);
        throw error;
    }
}


//Main ,Login and Sign-up Route
app.get("/", async (req, res) => {

    res.render("index.ejs", );
    //res.render("test.ejs");
});
app.get("/about", async (req, res) => {

    res.render("about.ejs", );
    //res.render("test.ejs");
});
app.get("/contact", async (req, res) => {

    res.render("contact.ejs", );
    //res.render("test.ejs");
});
app.get("/login", async (req, res) => {



    res.render("login.ejs" );
});
app.get("/register", async (req, res) => {



    res.render("signup.ejs" );


    // res.render("index.ejs", { secret: "" ,user: ""});
});

app.post("/signup", async (req, res) => {
    const { first_name, last_name, email, password } = req.body;

    // Check if any of the fields are empty
    if (!first_name || !last_name || !email || !password ) {
        return res.render("signup.ejs", { error: "All fields are required!" });
    }

    try {
        // Check if the email already exists
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);

        if (checkResult.rows.length > 0) {
            res.render("signup.ejs", { error: "Email already exists. Try logging in." });
        } else {
            // If email does not exist, hash the password
            bcrypt.hash(password, saltRounds, async (err, hash) => {
                if (err) {
                    console.log("Error hashing the password", err);
                } else {
                    // Insert the new user into the database
                    try {
                        const result = await db.query(
                            "INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING user_id",
                            [first_name, last_name, email, hash]
                        );

                        user_id = result.rows[0].user_id;

                        // // Fetch the books that the new user has read
                        // const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
                        // const books = booksResult.rows;
                        //
                        // // Render the welcome page with the books
                        // res.render("welcome.ejs", { books: books });
                        res.redirect("/main");
                    } catch (error) {
                        console.log("Error inserting user:", error);
                        res.render("signup.ejs", { error: "An error occurred. Please try again." });
                    }
                }
            });
        }
    } catch (err) {
        console.log("Error checking for existing email:", err);
        res.render("signup.ejs", { error: "An error occurred. Please try again." });
    }
});
app.post('/login', async (req, res) => {
    const email = req.body.email;
    const loginPassword = req.body.password;

    try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            const storedHashPassword = user.password;

            // Compare the entered password with the stored hashed password
            bcrypt.compare(loginPassword, storedHashPassword, async (err, isMatch) => {
                if (err) {
                    console.log("Error comparing password: ", err);
                    res.send("Error comparing password");
                } else {
                    if (isMatch) {
                        // Fetch the books that the user has read
                        user_id = user.user_id;
                        // console.log(user_id);
                        // const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
                        // const books = booksResult.rows;
                        //
                        // // Render the welcome page with the books
                        // res.render("welcome.ejs", { books: books });
                        res.redirect("/main");
                    } else {
                        // Render the login page with an error message
                        res.render("login.ejs", { error: "Incorrect Password" });
                    }
                }
            });
        } else {
            // Render the login page with an error message for user not found
            res.render("login.ejs", { error: "User not found" });
        }
    } catch (err) {
        console.log("Database query error: ", err);
        res.status(500).send("Error accessing the database");
    }
});


app.get("/main", async (req, res) => {

    // Render the welcome page with the books
    res.render("welcome.ejs");
});

//The Book Feature
app.get("/books", async (req, res) => {

    //res.render("index.ejs", );
    //book feature
    const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
    const books = booksResult.rows;

    res.render("booksRead.ejs", {books: books});
});
app.get('/newbook', (req, res) => {
    res.render('newbook.ejs',{listTitle:"Add a New Book"}); // Renders the newbook.ejs file
});
app.post('/add-book', async (req, res) => {
    const {title, date, rating, notes} = req.body;
    const item = req.body.newItem;
    db.query("INSERT INTO readBooks (title,date,rating,notes,userid) VALUES($1,$2,$3,$4,$5)", [title, date, rating, notes, user_id]);
    const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
    const books = booksResult.rows;
    res.render("welcome.ejs",{books:books});
});
app.get("/delete", (req, res) => {
    //I need to change this to delete not get
    const bookId = parseInt(req.query.id, 10);

    db.query("Delete FROM readBooks WHERE id = $1",[bookId],async (err, result) => {
        if (err) {
            console.error("Error updating item:", err.stack);
        } else {
            console.log("Item updated successfully!");
            const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
            const books = booksResult.rows;
            res.render("welcome.ejs", {books: books});
        }
    });
});
app.get("/edit", async (req, res) => {
    const bookId = parseInt(req.query.id, 10); // Ensure bookId is an integer
    const result = await db.query("SELECT * FROM readBooks WHERE id = $1", [bookId]); // Use parameterized queries to prevent SQL injection

    console.log(result.rows[0]); // This will log the fetched book

    if (result.rows.length > 0) {
        res.render("editBook.ejs", { book: result.rows[0] }); // Pass the first row to the template
    } else {
        res.status(404).send('Book not found'); // Handle case if no book is found
    }
});
app.post('/edit-book', async (req, res) => {
    const {title, date, rating, notes} = req.body;
    const id = parseInt(req.query.id, 10);
    const item = req.body.newItem;
    db.query("UPDATE readBooks SET title = $1 , date = $2 , rating= $3 , notes = $4 WHERE id = $5", [title, date, rating, notes, id]);
    const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
    const books = booksResult.rows;
    res.render("welcome.ejs", {books: books});
});


//To-do Feature
app.get("/todo-list", async (req, res) => {

    //res.render("index.ejs", );
    //Todo feature
    const result = await db.query("SELECT * FROM items WHERE userid = $1", [user_id]);
    items = result.rows;

    res.render("todolist.ejs", {
        listTitle: "Today",
        listItems: items,
    });
});
app.post("/addItem", (req, res) => {
    const item = req.body.newItem;
    db.query("INSERT INTO items (title,userid) VALUES($1,$2)",[item,user_id]);
    res.redirect("/main");
});
app.post("/editItem", (req, res) => {
    console.log(req.body);
    db.query("UPDATE items SET title = $1 WHERE id = $2",[req.body.updatedItemTitle,req.body.updatedItemId],(err, result) => {
        if (err) {
            console.error("Error updating item:", err.stack);
        } else {
            console.log("Item updated successfully!");
            res.redirect("/main");
        }
    });
});
app.post("/deleteItem", (req, res) => {
    //needs to change to delete not post
    console.log(req.body);

    db.query("Delete FROM items WHERE id = $1",[req.body.deleteItemId],(err, result) => {
        if (err) {
            console.error("Error updating item:", err.stack);
        } else {
            console.log("Item updated successfully!");
            res.redirect("/main");
        }
    });
});

//The forum feature
app.get("/forums", async (req, res) => {
    const { subject } = req.query; // Get the selected subject from query params
    const subjects = [
        "Programming 1",
        "Programming 3",
        "Calculus",
        "Business Law",
        "Data Driven System",
        "Object Oriented Design"
    ];

    let forumData = [];
    let subjectSelected = false;

    if (subject) {
        subjectSelected = true;
        // Fetch forum posts filtered by selected subject
        const forumResult = await db.query("SELECT * FROM forum_posts WHERE subject = $1", [subject]);
        forumData = forumResult.rows;
    }

    res.render("forum.ejs", { forumData, subjects, selectedSubject: subject, subjectSelected });
});
app.post("/addforum", async (req, res) => {
    const { name, surname, topic, problem, selectedSubject } = req.body;
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format

    try {
        await db.query(
            "INSERT INTO forum_posts (name, surname, subject, topic, problem, date) VALUES ($1, $2, $3, $4, $5, $6)",
            [name, surname, selectedSubject, topic, problem, date]
        );
        res.redirect(`/forums?subject=${selectedSubject}`); // Redirect back to the selected subject
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding forum post");
    }
});



//The course
app.get("/course/:subject", async (req, res) => {
    const subject = req.params.subject;
    const slidesPath = path.join(__dirname, "public", "Course", subject, "slides");
    currentSubject = subject;



    let slides = [];

    try {
        // Read all slide filenames in the subject's slides folder
        slides = fs.readdirSync(slidesPath)
            .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); // Sort numerically (Lecture 01, 02...)

    } catch (error) {
        console.error("Error reading slides:", error);
    }
    const slidesPathPersonal = path.join(__dirname, "Workstation", String(user_id), subject, "slides");

    let personalslides = [];
    try {
        // Read all slide filenames in the subject's slides folder
        personalslides = fs.readdirSync(slidesPathPersonal)
            .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); // Sort numerically (Lecture 01, 02...)

    } catch (error) {
        console.error("Error reading slides:", error);
    }

    // Render course.ejs with the subject and slides
    res.render("course.ejs", { subject, slides,personalslides,userid:user_id });
});
app.post("/uploadPdf", upload.single('pdfFile'), (req, res) => {
    // if (!req.file) {
    //     return res.status(400).send('No file uploaded.');
    // }

    console.log(currentSubject);
    res.redirect(`/main`);
});

//The Time table feature
app.get('/timetable', async (req, res) => {
    try {
        //const user_id = req.session.user_id || 1; // Replace with actual session user ID
        const result = await db.query(
            `SELECT * FROM timetable WHERE userid = $1`,
            [user_id]
        );
        console.log(user_id);
        const timetable = result.rows; // Extract results

        console.log(timetable); // Debugging: print fetched timetable

        res.render('timetable.ejs', { timetable });
    } catch (err) {
        console.error('Error fetching timetable:', err);
        res.status(500).send('Error fetching timetable');
    }


});
app.post('/addSubject', async(req, res) => {
    const { day, startTime, endTime, subject, classType } = req.body;

    // Get color for subject
    const color = getSubjectColor(subject);

    // Generate new ID
    //const newId = timetable.length ? Math.max(...timetable.map(entry => entry.id)) + 1 : 1;

    // Validate that startTime is before endTime
    if (startTime >= endTime) {
        return res.render('timetable.ejs', { timetable: [], errorMessage: "Start time must be before end time." });
    }

    // Check for overlapping times
    const conflict = timetable.some(entry =>
        entry.day === day &&
        !(
            (endTime <= entry.startTime) || (startTime >= entry.endTime) // No overlap condition
        )
    );

    if (conflict) {
        return res.render('timetable.ejs', { timetable, errorMessage: "Time slot overlaps with another subject." });
    }

    // Add the new subject with the assigned color
    try {
        await db.query(`INSERT INTO timetable (day, starttime, endtime, subject, classtype, color, userid)
        VALUES ($1, $2, $3, $4, $5, $6, $7) `, [day, startTime, endTime, subject, classType, color, user_id]);
    //timetable.push({ id: newId, day, startTime, endTime, subject, classType, color });

    } catch (err) {
        console.error('Error adding timetable entry:', err);
        res.status(500).send('Error adding timetable entry');
    }

    res.redirect('/timetable');
});
app.post("/deleteSubject", async (req, res) => {
    const { subject, day, startTime,subjectID } = req.body;
    //const user_id = req.session.user_id || 1; // Replace with actual session user ID

    try {

        await db.query(`DELETE FROM timetable  WHERE userid = $1 AND subject = $2 AND day = $3 AND id = $4`, [user_id, subject, day,subjectID]);

        res.redirect("/timetable");
    } catch (err) {
        console.error("Error deleting timetable entry:", err);
        res.status(500).send("Error deleting timetable entry");
    }
});

//PDF viewer
app.get('/pdfview/:document', async (req, res) => {
    console.log(req.params); // Logs: { document: 'BUSINESS LAW 1 - Introduction to law.pdf' }

    const document = req.params.document;
    const slidesPath = path.join(__dirname, "public", "Course", currentSubject, "slides");

    // Construct the relative URL for the PDF
    const pdfUrl = path.join('/Course', currentSubject, 'slides', document); // relative path

    // Get all the PDF files in the directory
    const filess = fs.readdirSync(slidesPath).filter(file => file.endsWith('.pdf'));

    // Filter the files to find the specific document by matching the name
    const files = filess.find(file => file.replace('.pdf', '') === document.replace('.pdf', ''));

    if (!files) {
        return res.status(404).send('PDF file not found');
    }

    console.log(pdfUrl); // Logs the relative URL

    res.render('pdfviewer.ejs', { pdfUrl }); // Pass pdfUrl to the template
});

//flash-cards for Questions
app.get('/generateQuestions/:document', async (req, res) => {
    console.log(req.params); // Logs: { document: 'BUSINESS LAW 1 - Introduction to law.pdf' }


    // Construct the relative URL for the PDF
    const document = req.params.document;
    const filePath = path.join(__dirname, "public", "Course", currentSubject, "slides",document); // relative path
    console.log(filePath);

    //const filePath = path.join(process.cwd(), 'uploads', req.params.filename);
    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File not found.');
        }
        console.log("We are in the right track")
        const text = await extractTextFromPDF(filePath);
        const questions = await generateQuestions(text);
        const jsonObject = JSON.parse(questions);
        //res.json({ questions });

        const filePath2 = 'public/jsons/questions_and_answers.json';

        // Write the data to the JSON file
        fs.writeFile(filePath2, JSON.stringify(jsonObject, null, 4), (err) => {
            if (err) {
                console.log("Error writing to file:", err);
            } else {
                console.log(`Data has been saved to ${filePath}`);
                res.redirect("/flashcards");
            }
        });


    } catch (error) {
        res.status(500).send('Error generating questions: ' + error.message);
    }
});
app.get("/getFlashcards", (req, res) => {
    const filePath = "public/jsons/questions_and_answers.json";
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        res.json(JSON.parse(data));
    } else {
        res.status(404).json({ message: "No flashcards available" });
    }
});
app.get("/flashcards", (req, res) => {
    res.render("flashcards.ejs",{currentSubject});
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

