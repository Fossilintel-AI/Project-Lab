
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

//sessions and passport for cookies
import session from "express-session";
import passport from "passport";
import {Strategy} from "passport-local";

//email sender
import nodemailer from "nodemailer";

//allow all domains
import cors from "cors";




const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
// Serve static files from Workstation directory
app.use('/Workstation', express.static(path.join(__dirname, 'Workstation')));

app.use(cors());

//encryption
const saltRounds = 10;
global.user_id = -1;
global.currentSubject = null;

//sessions and cookies.
app.use(session({
    secret:"WebApplication",
    resave:false,
    saveUninitialized:true,
    cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());




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

// Function to generate the summarize  using Cohere
async function generateSummarize(text) {
    try {
        // const prompt = `Based on the following text, generate a set of questions and Answers Text in the form as key: value pair object {dont include question and answer tags ,let the answer start with ***}:\n\nText: ${text}`;
        const prompt = `Based on the following text, Generate a descriptive summary of the whole context covered 



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


//Function to generate questions using Cohere
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


//Email sender settings
const transporter = nodemailer.createTransport({
    service: "gmail", // Change this if using another email provider
    auth: {
        user: "fossil.application@gmail.com", // Replace with your email
        pass: "rgegmcxlctqrzjar"  // Use an App Password for Gmail
    }
});

function sendWelcomeEmail(userEmail, userName) {
    const mailOptions = {
        from: "fossil.application@gmail.com",
        to: userEmail,
        subject: "Welcome to EverythingLearn - Your Personalized e-Learning Hub!",
        html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #8c7258;">Welcome to EverythingLearn, ${userName}!</h2>
                <p>Dear ${userName},</p>
                <p>We’re thrilled to have you as part of our learning community. EverythingLearn is designed to enhance your educational journey with powerful features that help you stay organized and engaged.</p>
                
                <h3 style="color: #a58b69;">Here’s what you can do on EverythingLearn:</h3>
                <ul>
                    <li>📚 Explore and enroll in courses tailored to your interests.</li>
                    <li>📝 Access lecture notes, textbooks, and self-study resources.</li>
                    <li>✅ Keep track of your tasks with the built-in To-Do list.</li>
                    <li>📅 Plan your schedule with our interactive Timetable feature.</li>
                    <li>📖 Track the books you've read and gain insights from them.</li>
                    <li>🎯 Test your knowledge with AI-generated quizzes.</li>
                </ul>
                
                <p>We're committed to making your learning experience as smooth as possible.</p>
                
                <h3 style="color: #a58b69;">Need Help?</h3>
                <p>If you ever have any questions or encounter any issues, our support team is here to assist you.</p>
                <p>📧 <strong>Email:</strong> <a href="mailto:fossilintel@gmail.com">fossilintel@gmail.com</a></p>
                
                <p>Start your learning adventure today and make the most of your educational journey!</p>
                
                <p style="margin-top: 20px;">Best regards,</p>
                <p><strong>The EverythingLearn Team</strong></p>
            </div>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Error sending email:", error);
        } else {
            console.log("Welcome email sent:", info.response);
        }
    });
}

//Main ,Login and Sign-up Route
app.get("/", async (req, res) => {

    res.render("index.ejs", { user: user_id !== -1 ? "user Present" : null });

    //res.render("index.ejs", );
    //res.render("test.ejs");
});
app.get("/about", async (req, res) => {

    res.render("about.ejs", { user: user_id !== -1 ? "user Present" : null });
    // res.render("about.ejs", );
    //res.render("test.ejs");
});
app.get("/contact", async (req, res) => {

    res.render("contact.ejs", { user: user_id !== -1 ? "user Present" : null });

    //res.render("contact.ejs", );
    //res.render("test.ejs");
});
app.get("/login", async (req, res) => {
    console.log("we are here1");
    res.render("login.ejs" );
});
app.get("/register", async (req, res) => {
    res.render("signup.ejs" );
    // res.render("index.ejs", { secret: "" ,user: ""});
});


app.post("/signup", async (req, res) => {
    const { first_name, last_name, email, password, bio, home_address, subscription_type } = req.body;

    // Check if any of the required fields are empty
    if (!first_name || !last_name || !email || !password || !bio || !home_address || !subscription_type) {
        return res.render("signup.ejs", { error: "All fields are required!" });
    }

    try {
        // Check if the email already exists
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        if (checkResult.rows.length > 0) {
            return res.render("signup.ejs", { error: "Email already exists. Try logging in." });
        }

        // Hash the password
        bcrypt.hash(password, saltRounds, async (err, hash) => {
            if (err) {
                console.log("Error hashing the password", err);
                return res.render("signup.ejs", { error: "An error occurred. Please try again." });
            }

            try {
                // Insert the new user into the database, including bio, home address, and subscription type
                const result = await db.query(
                    "INSERT INTO users (first_name, last_name, email, password,subscription_type, bio, address ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
                    [first_name, last_name, email, hash,subscription_type, bio, home_address]
                );

                const user = result.rows[0];
                const checkResultID = await db.query("SELECT user_id FROM users WHERE email = $1", [email]);
                const userData = checkResultID.rows[0];
                user_id = userData.user_id;

                // Send Welcome Email
                sendWelcomeEmail(user.email, user.first_name);

                // Automatically log the user in after signup
                req.login(user, (err) => {
                    if (err) {
                        console.error("Login error after signup:", err);
                        return res.render("signup.ejs", { error: "Login failed after signup. Please try logging in." });
                    }
                    return res.redirect("/main"); // Redirect user to main page after login
                });

            } catch (error) {
                console.log("Error inserting user:", error);
                return res.render("signup.ejs", { error: "An error occurred. Please try again." });
            }
        });
    } catch (err) {
        console.log("Error checking for existing email:", err);
        return res.render("signup.ejs", { error: "An error occurred. Please try again." });
    }
});

// app.post("/signup", async (req, res) => {
//     const { first_name, last_name, email, password } = req.body;
//
//     // Check if any of the fields are empty
//     if (!first_name || !last_name || !email || !password) {
//         return res.render("signup.ejs", { error: "All fields are required!" });
//     }
//
//     try {
//         // Check if the email already exists
//         const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
//
//         if (checkResult.rows.length > 0) {
//             return res.render("signup.ejs", { error: "Email already exists. Try logging in." });
//         }
//
//         // Hash the password
//         bcrypt.hash(password, saltRounds, async (err, hash) => {
//             if (err) {
//                 console.log("Error hashing the password", err);
//                 return res.render("signup.ejs", { error: "An error occurred. Please try again." });
//             }
//
//             try {
//                 // Insert the new user into the database
//                 const result = await db.query(
//                     "INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING *",
//                     [first_name, last_name, email, hash]
//                 );
//
//                 const user = result.rows[0];
//                 const checkResultID = await db.query("SELECT user_id FROM users WHERE email = $1", [email]);
//                 const userData =  checkResultID.rows[0];
//                 user_id =userData.user_id;
//
//                 // Send Welcome Email
//                 sendWelcomeEmail(user.email, user.first_name);
//
//                 // Automatically log the user in after signup
//                 req.login(user, (err) => {
//                     if (err) {
//                         console.error("Login error after signup:", err);
//                         return res.render("signup.ejs", { error: "Login failed after signup. Please try logging in." });
//                     }
//
//                     return res.redirect("/main"); // Redirect user to main page after login
//                 });
//
//             } catch (error) {
//                 console.log("Error inserting user:", error);
//                 return res.render("signup.ejs", { error: "An error occurred. Please try again." });
//             }
//         });
//
//     } catch (err) {
//         console.log("Error checking for existing email:", err);
//         return res.render("signup.ejs", { error: "An error occurred. Please try again." });
//     }
// });


// app.post("/signup", async (req, res) => {
//     const { first_name, last_name, email, password } = req.body;
//
//     // Check if any of the fields are empty
//     if (!first_name || !last_name || !email || !password ) {
//         return res.render("signup.ejs", { error: "All fields are required!" });
//     }
//
//     try {
//         // Check if the email already exists
//         const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
//
//         if (checkResult.rows.length > 0) {
//             res.render("signup.ejs", { error: "Email already exists. Try logging in." });
//         } else {
//             // If email does not exist, hash the password
//             bcrypt.hash(password, saltRounds, async (err, hash) => {
//                 if (err) {
//                     console.log("Error hashing the password", err);
//                 } else {
//                     // Insert the new user into the database
//                     try {
//                         const result = await db.query(
//                             "INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING user_id",
//                             [first_name, last_name, email, hash]
//                         );
//
//                         user_id = result.rows[0].user_id;
//
//                         // // Fetch the books that the new user has read
//                         // const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
//                         // const books = booksResult.rows;
//                         //
//                         // // Render the welcome page with the books
//                         // res.render("welcome.ejs", { books: books });
//                         res.redirect("/main");
//                     } catch (error) {
//                         console.log("Error inserting user:", error);
//                         res.render("signup.ejs", { error: "An error occurred. Please try again." });
//                     }
//                 }
//             });
//         }
//     } catch (err) {
//         console.log("Error checking for existing email:", err);
//         res.render("signup.ejs", { error: "An error occurred. Please try again." });
//     }
// });


app.get("/main", async (req, res) => {
    if(req.isAuthenticated())
    {

        const currentUser = req.user;
        const subscription_type = currentUser.subscription_type;
        res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null,subscription_type  });

        //res.render("welcome.ejs");
    }
    else{
        res.redirect("/login");
    }
    // Render the welcome page with the books

});
// app.post(
//     "/login",
//     passport.authenticate("local", {
//
//         successRedirect: "/main",
//         failureRedirect: "/main",
//     })
//
// );


passport.use(new Strategy({
    usernameField: 'email',  // The name of the input field in the form for the email
    passwordField: 'password'  // The name of the input field in the form for the password
}, async function verify(email, password, cb) {
    console.log("Strategy called with:", email, password);
    try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const storedHashPassword = user.password;

            bcrypt.compare(password, storedHashPassword, (err, isMatch) => {
                if (err) {
                    return cb(err);
                }
                if (isMatch) {
                    user_id = user.user_id;
                    return cb(null, user);
                } else {
                    return cb(null, false, { message: "Incorrect password" });
                }
            });
        } else {
            return cb(null, false, { message: "User not found" });
        }
    } catch (err) {
        console.log("Database query error:", err);
        return cb(err);
    }
}));


app.post("/login", (req, res, next) => {

    console.log("Received credentials:", req.body);
    passport.authenticate("local", (err, user, info) => {
        if (err) {
            console.error("Authentication error:", err);
            return res.redirect("/login");
        }
        if (!user) {
            console.log("Authentication failed:", info.message);  // Get the error message from info
            return res.render("login.ejs", { error: info.message });  // Render login with the error message
        }
        req.login(user, (err) => {
            if (err) {
                console.error("Error logging in:", err);
                return res.redirect("/login");
            }
            console.log("User successfully logged in");
            return res.redirect("/main");
        });
    })(req, res, next);
});


// app.post('/login', async (req, res) => {
//     const email = req.body.email;
//     const loginPassword = req.body.password;
//
//     try {
//         const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
//
//         if (result.rows.length > 0) {
//             const user = result.rows[0];
//             const storedHashPassword = user.password;
//
//             // Compare the entered password with the stored hashed password
//             bcrypt.compare(loginPassword, storedHashPassword, async (err, isMatch) => {
//                 if (err) {
//                     console.log("Error comparing password: ", err);
//                     res.send("Error comparing password");
//                 } else {
//                     if (isMatch) {
//                         // Fetch the books that the user has read
//                         user_id = user.user_id;
//                         // console.log(user_id);
//                         // const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
//                         // const books = booksResult.rows;
//                         //
//                         // // Render the welcome page with the books
//                         // res.render("welcome.ejs", { books: books });
//                         res.redirect("/main");
//                     } else {
//                         // Render the login page with an error message
//                         res.render("login.ejs", { error: "Incorrect Password" });
//                     }
//                 }
//             });
//         } else {
//             // Render the login page with an error message for user not found
//             res.render("login.ejs", { error: "User not found" });
//         }
//     } catch (err) {
//         console.log("Database query error: ", err);
//         res.status(500).send("Error accessing the database");
//     }
// });

//Logging out
app.get("/logout", (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.session.destroy(() => {
            user_id = -1;
            res.redirect("/"); // Redirect to login page after logout
        });
    });
});

//user Profile
app.get("/profile", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/login"); // Redirect to login if not authenticated
    }

    // Assuming `req.user` contains user data after authentication
    const currentUser = {
        first_name: req.user.first_name,
        last_name: req.user.last_name,
        email: req.user.email,
        subscription_type: req.user.subscription_type,
        bio: req.user.bio,
        created_at: req.user.created_at,
        address: req.user.address
    };

    res.render("profile.ejs", { currentUser,user: user_id !== -1 ? "user Present" : null });
});

app.get("/edit-profile", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/login");
    }
    const currentUser = req.user;
    res.render("edit-profile.ejs", { currentUser,user: user_id !== -1 ? "user Present" : null});
});

app.post("/edit-profile", (req, res) => {
    const { first_name, last_name, bio, address } = req.body;
    // Assume you have an `updateUserProfile` function to update the database


    db.query("UPDATE users SET first_name = $1, last_name = $2, bio = $3, address = $4 WHERE user_id = $5", [first_name, last_name, email, bio, address, user_id])
        .then(() => {
            req.user.first_name = first_name;
            req.user.last_name = last_name;
            //req.user.email = email;
            req.user.bio = bio;
            req.user.address = address;
            // Redirect to the profile page after a successful update
            res.redirect("/profile");
        })
        .catch((err) => {
            // Handle any errors
            console.error("Error updating profile:", err);
            res.status(500).send("Error updating profile");
        });
});



//The Book Feature
app.get("/books", async (req, res) => {

    //res.render("index.ejs", );
    //book feature

    if(req.isAuthenticated())
    {
        const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
        const books = booksResult.rows;
        res.render("booksRead.ejs", { user: user_id !== -1 ? "user Present" : null,books: books });

        //res.render("booksRead.ejs", {books: books});
    }
    else{
        res.redirect("/login");
    }

});
app.get('/newbook', (req, res) => {
    if(req.isAuthenticated())
    {
        res.render("newbook.ejs", { user: user_id !== -1 ? "user Present" : null,listTitle:"Add a New Book" });

        //res.render('newbook.ejs',{listTitle:"Add a New Book"});
    }
    else{
        res.redirect("/login");
    }

   //Renders the newbook.ejs file
});
app.post('/add-book', async (req, res) => {

    if(req.isAuthenticated())
    {
        const {title, date, rating, notes} = req.body;
        const item = req.body.newItem;
        db.query("INSERT INTO readBooks (title,date,rating,notes,userid) VALUES($1,$2,$3,$4,$5)", [title, date, rating, notes, user_id]);
        const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
        const books = booksResult.rows;
        res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null, books:books });

        //res.render("welcome.ejs",{books:books});
    }
    else{
        res.redirect("/login");
    }


});
app.get("/delete", (req, res) => {
    //I need to change this to delete not get

    if(req.isAuthenticated())
    {
        const bookId = parseInt(req.query.id, 10);

        db.query("Delete FROM readBooks WHERE id = $1",[bookId],async (err, result) => {
            if (err) {
                console.error("Error updating item:", err.stack);
            } else {
                console.log("Item updated successfully!");
                const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
                const books = booksResult.rows;
                res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null,books: books });

                //res.render("welcome.ejs", {books: books});
            }
        });
    }
    else{
        res.redirect("/login");
    }

});
app.get("/edit", async (req, res) => {

    if(req.isAuthenticated())
    {
        const bookId = parseInt(req.query.id, 10); // Ensure bookId is an integer
        const result = await db.query("SELECT * FROM readBooks WHERE id = $1", [bookId]); // Use parameterized queries to prevent SQL injection

        console.log(result.rows[0]); // This will log the fetched book

        if (result.rows.length > 0) {
            res.render("editBook.ejs", { user: user_id !== -1 ? "user Present" : null,book: result.rows[0] });

            //res.render("editBook.ejs", { book: result.rows[0] }); // Pass the first row to the template
        } else {
            res.status(404).send('Book not found'); // Handle case if no book is found
        }
    }
    else{
        res.redirect("/login");
    }

});
app.post('/edit-book', async (req, res) => {

    if(req.isAuthenticated())
    {
        const {title, date, rating, notes} = req.body;
        const id = parseInt(req.query.id, 10);
        const item = req.body.newItem;
        db.query("UPDATE readBooks SET title = $1 , date = $2 , rating= $3 , notes = $4 WHERE id = $5", [title, date, rating, notes, id]);
        const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
        const books = booksResult.rows;
        res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null,books: books });

        //res.render("welcome.ejs", {books: books});
    }
    else{
        res.redirect("/login");
    }

});


//To-do Feature
app.get("/todo-list", async (req, res) => {

    if(req.isAuthenticated())
    {
        //res.render("index.ejs", );
        //Todo feature
        const result = await db.query("SELECT * FROM items WHERE userid = $1", [user_id]);
        items = result.rows;

        res.render("todolist.ejs", {
            listTitle: "Today",
            listItems: items,
            user: user_id !== -1 ? "user Present" : null,
        });
    }
    else{
        res.redirect("/login");
    }

});
app.post("/addItem", (req, res) => {
    if(req.isAuthenticated())
    {
        const item = req.body.newItem;
        db.query("INSERT INTO items (title,userid) VALUES($1,$2)",[item,user_id]);
        res.redirect("/todo-list");
    }
    else{
        res.redirect("/login");
    }


});
app.post("/editItem", (req, res) => {
    if(req.isAuthenticated())
    {
        console.log(req.body);
        db.query("UPDATE items SET title = $1 WHERE id = $2",[req.body.updatedItemTitle,req.body.updatedItemId],(err, result) => {
            if (err) {
                console.error("Error updating item:", err.stack);
            } else {
                console.log("Item updated successfully!");
                res.redirect("/todo-list");
            }
        });
    }
    else{
        res.redirect("/login");
    }


});
app.post("/deleteItem", (req, res) => {
    if(req.isAuthenticated())
    {
        //needs to change to delete not post
        console.log(req.body);

        db.query("Delete FROM items WHERE id = $1",[req.body.deleteItemId],(err, result) => {
            if (err) {
                console.error("Error updating item:", err.stack);
            } else {
                console.log("Item updated successfully!");
                res.redirect("/todo-list");
            }
        });
    }
    else{
        res.redirect("/login");
    }


});

//The forum feature
app.get("/forums", async (req, res) => {
    if(req.isAuthenticated())
    {
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

        res.render("forum.ejs", { forumData, subjects, selectedSubject: subject, subjectSelected,user: user_id !== -1 ? "user Present" : null,isAdmin: "" });
    }
    else{
        res.redirect("/login");
    }


});
app.post("/addforum", async (req, res) => {
    if(req.isAuthenticated())
    {
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
    }
    else{
        res.redirect("/login");
    }


});
app.post('/addAdminCommentForum', async (req, res) => {
    if(req.isAuthenticated()) {
        const {comment, postId} = req.body;
        // Assuming you have a function to update the admin comment in the database

        try {
            await db.query(
                "UPDATE forum_posts SET admin_comment = $1 WHERE id = $2 ",
                [comment, postId]
            );
            res.redirect('/forums?subject=' + req.query.subject); // Redirect back to the forum page
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding forum post");
        }
    }
    else{
        res.redirect("/login");
    }
});


//The course
app.get("/course/:subject", async (req, res) => {
    if(req.isAuthenticated())
    {
        const currentUser = req.user;
        const subscription_type = currentUser.subscription_type;
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
        res.render("course.ejs", { subject, slides,personalslides,userid:user_id, user: user_id !== -1 ? "user Present" : null,subscription_type });
    }
    else{
        res.redirect("/login");
    }


});
app.post("/uploadPdf", upload.single('pdfFile'), (req, res) => {
    // if (!req.file) {
    //     return res.status(400).send('No file uploaded.');
    // }
    if(req.isAuthenticated())
    {

        //Need to fix the redirection
        console.log(currentSubject);
        res.redirect(`/main`);
    }
    else{
        res.redirect("/login");
    }


});

//The Time table feature
app.get('/timetable', async (req, res) => {
    if(req.isAuthenticated())
    {
        try {
            //const user_id = req.session.user_id || 1; // Replace with actual session user ID
            const result = await db.query(
                `SELECT * FROM timetable WHERE userid = $1`,
                [user_id]
            );
            console.log(user_id);
            const timetable = result.rows; // Extract results

            console.log(timetable); // Debugging: print fetched timetable

            res.render('timetable.ejs', { timetable,user: user_id !== -1 ? "user Present" : null });
        } catch (err) {
            console.error('Error fetching timetable:', err);
            res.status(500).send('Error fetching timetable');
        }

    }
    else{
        res.redirect("/login");
    }



});
app.post('/addSubject', async(req, res) => {

    if(req.isAuthenticated())
    {
        const { day, startTime, endTime, subject, classType } = req.body;

        // Get color for subject
        const color = getSubjectColor(subject);

        // Generate new ID
        //const newId = timetable.length ? Math.max(...timetable.map(entry => entry.id)) + 1 : 1;

        // Validate that startTime is before endTime
        if (startTime >= endTime) {
            return res.render('timetable.ejs', { timetable: [], errorMessage: "Start time must be before end time.",user: user_id !== -1 ? "user Present" : null });
        }

        // Check for overlapping times
        const conflict = timetable.some(entry =>
            entry.day === day &&
            !(
                (endTime <= entry.startTime) || (startTime >= entry.endTime) // No overlap condition
            )
        );

        if (conflict) {
            return res.render('timetable.ejs', { timetable, errorMessage: "Time slot overlaps with another subject.",user: user_id !== -1 ? "user Present" : null });
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
    }
    else{
        res.redirect("/login");
    }

});
app.post("/deleteSubject", async (req, res) => {
    if(req.isAuthenticated())
    {
        const { subject, day, startTime,subjectID } = req.body;
        //const user_id = req.session.user_id || 1; // Replace with actual session user ID

        try {

            await db.query(`DELETE FROM timetable  WHERE userid = $1 AND subject = $2 AND day = $3 AND id = $4`, [user_id, subject, day,subjectID]);

            res.redirect("/timetable");
        } catch (err) {
            console.error("Error deleting timetable entry:", err);
            res.status(500).send("Error deleting timetable entry");
        }
    }
    else{
        res.redirect("/login");
    }


});

//PDF viewer
app.get('/pdfview/:document', async (req, res) => {
    if(req.isAuthenticated())
    {
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

        res.render('pdfviewer.ejs', { pdfUrl,user: user_id !== -1 ? "user Present" : null }); // Pass pdfUrl to the template
    }
    else{
        res.redirect("/login");
    }


});

//flash-cards for Questions
app.get('/generateQuestions/:document', async (req, res) => {
    if (req.isAuthenticated()) {
        console.log(req.params); // Logs: { document: 'BUSINESS LAW 1 - Introduction to law.pdf' }

        const document = req.params.document;
        const filePath = path.join(__dirname, "public", "Course", currentSubject, "slides", document); // relative path

        console.log(filePath);

        try {
            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found.');
            }

            console.log("We are in the right track");

            const text = await extractTextFromPDF(filePath);
            const questions = await generateQuestions(text);
            const jsonObject = JSON.parse(questions);

            const filePath2 = 'public/jsons/questions_and_answers.json';

            // Write the data to the JSON file asynchronously
            fs.writeFile(filePath2, JSON.stringify(jsonObject, null, 4), (err) => {
                if (err) {
                    console.log("Error writing to file:", err);
                    return res.status(500).send('Error saving questions.');
                }

                console.log(`Data has been saved to ${filePath2}`);

                // Make sure to send the response here
                return res.redirect("/flashcards"); // or another route as needed
            });
        } catch (error) {
            console.error("Error generating questions:", error);
            return res.status(500).send('Error generating questions: ' + error.message);
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/getFlashcards", async (req, res) => {
    if (req.isAuthenticated()) {
        const filePath = "public/jsons/questions_and_answers.json";
        try {
            // Use fs.promises.access() to check file existence
            await fs.promises.access(filePath, fs.constants.F_OK);

            const data = await fs.promises.readFile(filePath, "utf8");
            res.json(JSON.parse(data));
        } catch (err) {
            if (err.code === 'ENOENT') {
                // File doesn't exist
                res.status(404).json({ message: "No flashcards available" });
            } else {
                console.error("Error reading file:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        }
    } else {
        res.redirect("/login");
    }
});

// app.get("/getFlashcards", (req, res) => {
//     if(req.isAuthenticated())
//     {
//         const filePath = "public/jsons/questions_and_answers.json";
//         if (fs.existsSync(filePath)) {
//             const data = fs.readFileSync(filePath, "utf8");
//             res.json(JSON.parse(data));
//         } else {
//             res.status(404).json({ message: "No flashcards available" });
//         }
//     }
//     else{
//         res.redirect("/login");
//     }
//
//
// });
app.get("/flashcards", (req, res) => {
    if(req.isAuthenticated())
    {
        res.render("flashcards.ejs",{currentSubject, user: user_id !== -1 ? "user Present" : null});
    }
    else{
        res.redirect("/login");
    }


});

//feature for summurization
// Route to summarize text


app.get("/summarize/:document", async (req, res) => {
    if (req.isAuthenticated()) {
        const document = req.params.document;
        const filePath = path.join(__dirname, "public", "Course", currentSubject, "slides", document); // relative path

        // Debugging log for file path
        console.log("Requested file path:", filePath);

        try {
            // Check if the file exists
            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found.');
            }

            // Extracting text from the PDF
            console.log("File found, extracting text...");
            const text = await extractTextFromPDF(filePath);

            // Summarizing the text

            // const summary = await summarizeText(text);
            // console.log("Summary generated:", summary);
            const summary = await generateSummarize(text);
            console.log("Summary generated:", summary);

            // Rendering the summary
             // Adjusting based on the summary format
            res.render("summarize.ejs", {
                summary,
                user: user_id !== -1 ? "user Present" : null
            });

        } catch (error) {
            console.error("Error generating summary:", error);
            return res.status(500).send('Error generating Summary: ' + error.message);
        }
    } else {
        res.redirect("/login");
    }
});

//sessions and passport
passport.serializeUser((user, cb) => {
    cb(null, user);
});

passport.deserializeUser((user, cb) => {

    cb(null, user);
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

