//set up the server
const express = require( "express" );
const logger = require("morgan");
const { auth } = require('express-openid-connect');
const { requiresAuth } = require('express-openid-connect');
const dotenv = require('dotenv');
dotenv.config();

const helmet = require("helmet");
const db = require('./db/db_pool');
const app = express();
const port = process.env.PORT || 8080;

// Configure Express to use EJS
app.set( "views",  __dirname + "/views");
app.set( "view engine", "ejs" );

//Configure Express to use certain HTTP headers for security
//Explicitly set the CSP to allow the source of Materialize
app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'cdnjs.cloudflare.com'],
      }
    }
  })); 
  

const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH0_SECRET,
    baseURL: process.env.AUTH0_BASE_URL,
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL
};

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(config));

// Configure Express to parse incoming JSON data
// app.use( express.json() );
// Configure Express to parse URL-encoded POST request bodies (traditional forms)
app.use( express.urlencoded({ extended: false }) );

// define middleware that logs all incoming requests
app.use(logger("dev"));

// define middleware that serves static resources in the public directory
app.use(express.static(__dirname + '/public'));

// define middleware that appends useful auth-related information to the res object
// so EJS can easily access it
app.use((req, res, next) => {
    res.locals.isLoggedIn = req.oidc.isAuthenticated();
    res.locals.user = req.oidc.user;
    try {
        res.locals.email = req.oidc.user.email;
    }
    catch(err) {

    }
    next();
})

// req.isAuthenticated is provided from the auth router
app.get('/authtest', (req, res) => {
    res.send(req.oidc.isAuthenticated() ? 'Logged in' : 'Logged out');
});

app.get('/profile', requiresAuth(), (req, res) => {
    res.send(JSON.stringify(req.oidc.user));
});

// define a route for the default home page
app.get( "/", ( req, res ) => {
    res.render('index');
} );

// define a route for the stuff inventory page
const read_stuff_all_sql = `
SELECT id, item, quantity,
(SELECT category_name FROM categories WHERE user_email = stuff.userid LIMIT 1) as category 
FROM stuff
WHERE userid = ?;
`

app.get( "/stuff", requiresAuth(), ( req, res ) => {
    db.execute(read_stuff_all_sql, [req.oidc.user.email], (error, results) => {
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            console.log(results);
            res.render('stuff', { inventory : results });
        }
    });
} );

const get_user_categories = `
    SELECT
        category_name, category_id
    FROM 
        categories
    WHERE 
        user_email = ?
`
app.get("/categories", requiresAuth(), ( req, res ) => {
    db.execute(get_user_categories, [req.oidc.user.email], (error, results) => {
        if (error) {
            res.status(500).send(error); //Internal Server Error
        }
        else {
            let data = results
            res.render('categories', { inventory : data })
        }
    })
})



// define a route for the item detail page
const read_stuff_item_sql = `
    SELECT 
        id, item, quantity, description 
    FROM
        stuff
    WHERE
        id = ?
    AND
        userid = ?
`
app.get( "/stuff/item/:id", requiresAuth(), ( req, res ) => {
    db.execute(read_stuff_item_sql, [req.params.id, req.oidc.user.email], (error, results) => {
        if (error)
            res.status(500).send(error); //Internal Server Error
        else if (results.length == 0)
            res.status(404).send(`No item found with id = "${req.params.id}"` ); // NOT FOUND
        else {
            let data = results[0]; // results is still an array
            // data's object structure: 
            //  { id: ____, item: ___ , quantity:___ , description: ____ }
            res.render('item', data);
        }
    });
});

// define a route for item DELETE
const delete_item_sql = `
    DELETE 
    FROM
        stuff
    WHERE
        id = ?
    AND
        userid = ?
`
app.get("/stuff/item/:id/delete", requiresAuth(), ( req, res ) => {
    db.execute(delete_item_sql, [req.params.id, req.oidc.user.email], (error, results) => {
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            res.redirect("/stuff");
        }
    });
})

const delete_category_sql = `
    DELETE
    FROM
        categories
    WHERE
        category_id = ?
    AND
        user_id = ?
`

app.get("/categories/:id/delete", requiresAuth(), ( req, res ) => { 
    console.log(req.params.id)
    db.execute(delete_category_sql, [req.params.id, req.oidc.user.email], (error, results) => {
        if (error) {
            res.status(500).send(error); //Internal Server Error
        }
        else {
            res.redirect("/categories")
        }
    })
})

// define a route for item UPDATE
const update_item_sql = `
    UPDATE
        stuff
    SET
        item = ?,
        quantity = ?,
        description = ?
    WHERE
        id = ?
    AND
        userid = ?
`
app.post("/stuff/item/:id", requiresAuth(), ( req, res ) => {
    db.execute(update_item_sql, [req.body.name, req.body.quantity, req.body.description, req.params.id, req.oidc.user.email], (error, results) => {
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            res.redirect(`/stuff/item/${req.params.id}`);
        }
    });
})

// define a route for item CREATE
const create_item_sql = `
    INSERT INTO stuff
        (item, quantity, userid)
    VALUES
        (?, ?, ?)
`
app.post("/stuff", requiresAuth(), ( req, res ) => {
    db.execute(create_item_sql, [req.body.name, req.body.quantity, req.oidc.user.email], (error, results) => {
        if (error)
            res.status(500).send(error); //Internal Server Error
        else {
            //results.insertId has the primary key (id) of the newly inserted element.
            res.redirect(`/stuff/item/${results.insertId}`);
        }
    });
})

// const get_categories_sql = `
// SELECT category_name
// FROM categories
// WHERE user_email = ?;
// `

// app.get('/categories/:id', requiresAuth(), (req, res) => {
//     db.execute(get_categories_sql, [req.oidc.user.email], (err, results) => {
//         if (err) {
//             res.status(500).send(err);
//         }
//     })
// })

const create_category_sql = `
    INSERT INTO categories 
        (user_email, category_name) 
    VALUES 
        (?, ?)
`

app.post('/categories/:email', requiresAuth(), ( req, res ) => {
    // console.log(req.params.email)
    db.execute(create_category_sql, [ req.params.email, req.body.category_name ], (err, results) => {
        if (err) {
            res.status(500).send(err); //Internal Server Error
        }
        res.redirect(`/categories`)
    })
})

// start the server
app.listen( port, () => {
    console.log(`App server listening on ${ port }. (Go to http://localhost:${ port })` );
} );