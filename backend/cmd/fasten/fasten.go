package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"github.com/analogj/go-util/utils"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/applog"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/search"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/version"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/web"
	"github.com/fastenhealth/fasten-onprem/backend/resources"
	"github.com/sirupsen/logrus"
	"github.com/urfave/cli/v2"
	"strings"
)

var goos string
var goarch string

func main() {
	log.Print("Starting fasten-onprem")
	defer log.Print("Finished fasten-onprem")
	appconfig, err := config.Create()
	if err != nil {
		fmt.Printf("FATAL: %+v\n", err)
		os.Exit(1)
	}

	// No config file is read at all (yourphr#470, #474).
	//
	// This used to load "config.yaml" from the working directory automatically, which made it a
	// silent configuration layer on every deployment. Defaults now ship embedded in the binary
	// (app-default-config.json), .env supplies bootstrap, an instance overrides the rest in
	// <data>/config/app-custom-config.json, and the environment overrides everything — a
	// documented precedence, and no file appearing by proximity.

	app := &cli.App{
		Name:     "goweb",
		Usage:    "Example go web application",
		Version:  version.VERSION,
		Compiled: time.Now(),
		Authors: []*cli.Author{
			{
				Name:  "Jason Kulatunga",
				Email: "jason@thesparktree.com",
			},
		},
		Before: func(c *cli.Context) error {

			packagrUrl := "github.com/fastenhealth/fasten-onprem"

			versionInfo := fmt.Sprintf("%s.%s-%s", goos, goarch, version.VERSION)

			subtitle := packagrUrl + utils.LeftPad2Len(versionInfo, " ", 53-len(packagrUrl))

			fmt.Fprint(c.App.Writer, fmt.Sprintf(utils.StripIndent(
				`
			  o888o                       o8                          
			o888oo ooooooo    oooooooo8 o888oo ooooooooo8 oo oooooo   
			 888   ooooo888  888ooooooo  888  888oooooo8   888   888  
			 888 888    888          888 888  888          888   888  
			o888o 88ooo88 8o 88oooooo88   888o  88oooo888 o888o o888o
			%s

			`), subtitle))
			return nil
		},

		Commands: []*cli.Command{
			{
				Name:  "start",
				Usage: "Start the fasten server",
				Action: func(c *cli.Context) error {
					if err := rejectRemovedConfigFlag(c); err != nil {
						return err
					}

					//process cli variables
					if c.IsSet("variable") {
						appconfig.Set("variable", c.String("variable"))
					}
					if c.Bool("debug") {
						appconfig.Set("log.level", "DEBUG")
					}
					if c.IsSet("log-file") {
						appconfig.Set("log.file", c.String("log-file"))
					}

					appLogger, logFile, err := CreateLogger(appconfig)
					if logFile != nil {
						defer logFile.Close()
					}
					if err != nil {
						return err
					}

					// ensure panics are written to the log file.
					defer func() {
						if err := recover(); err != nil {
							appLogger.Panic("panic occurred:", err)
						}
					}()

					// Check if Typesense (search) is enabled and initialize it
					if appconfig.GetBool("search.enabled") {
						err = search.Init(appconfig, appLogger)
						if err != nil {
							appLogger.Error("failed to initialize Typesense: %w", err)
						}

						appLogger.Info("Typesense initialized successfully")
					} else {
						appLogger.Info("Search is disabled, skipping Typesense initialization.")
					}

					settingsData, err := json.Marshal(appconfig.AllSettings())
					appLogger.Debug(string(settingsData), err)

					relatedVersions, _ := resources.GetRelatedVersions()

					webServer := web.AppEngine{
						Config:          appconfig,
						Logger:          appLogger,
						EventBus:        event_bus.NewEventBusServer(appLogger),
						RelatedVersions: relatedVersions,
					}
					return webServer.Start()
				},

				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:  "config",
						Usage: "REMOVED. Configuration comes from .env and YOURPHR_* environment variables",
					},
					&cli.StringFlag{
						Name:  "variable",
						Value: "default",
						Usage: "The variable used by webserver",
					},
					&cli.StringFlag{
						Name:  "log-file",
						Usage: "Path to file for logging. Leave empty to use STDOUT",
						Value: "",
					},
					&cli.BoolFlag{
						Name:    "debug",
						Usage:   "Enable debug logging",
						EnvVars: []string{"DEBUG"},
					},
				},
			},
			{
				Name:  "version",
				Usage: "Print the version",
				Action: func(c *cli.Context) error {
					fmt.Println(version.VERSION)
					return nil
				},
			},
			{
				Name:  "migrate",
				Usage: "Run database migrations, without starting application",
				Action: func(c *cli.Context) error {

					if err := rejectRemovedConfigFlag(c); err != nil {
						return err
					}

					if c.Bool("debug") {
						appconfig.Set("log.level", "DEBUG")
					}

					appLogger, logFile, err := CreateLogger(appconfig)
					if logFile != nil {
						defer logFile.Close()
					}
					if err != nil {
						return err
					}

					// ensure panics are written to the log file.
					defer func() {
						if err := recover(); err != nil {
							appLogger.Panic("panic occurred:", err)
						}
					}()

					_, err = database.NewRepository(appconfig, appLogger, event_bus.NewNoopEventBusServer())
					return err
				},
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:  "config",
						Usage: "REMOVED. Configuration comes from .env and YOURPHR_* environment variables",
					},
					&cli.BoolFlag{
						Name:    "debug",
						Usage:   "Enable debug logging",
						EnvVars: []string{"DEBUG"},
					},
				},
			},
			{
				// The recovery path for "nobody can sign in at all" (#510). There is no password
				// reset in the product — no route, no SMTP, and "Forgot password?" is a link with no
				// target — so before this, recovery meant generating a bcrypt hash outside the app
				// and running an UPDATE by hand. That has been done twice, and it is why the demo
				// host's admin account was unreachable for a whole release cycle.
				//
				// The ADMIN-initiated reset (#511) does not cover this case: it needs a session, and
				// what keeps happening is that the only admin is locked out.
				Name:      "reset-password",
				Usage:     "Set a generated password for an account, for when nobody can sign in",
				ArgsUsage: "--username <name>",
				Action: func(c *cli.Context) error {
					if err := rejectRemovedConfigFlag(c); err != nil {
						return err
					}

					username := strings.TrimSpace(c.String("username"))
					if username == "" {
						return fmt.Errorf("--username is required, e.g. fasten reset-password --username owner")
					}

					if c.Bool("debug") {
						appconfig.Set("log.level", "DEBUG")
					}

					appLogger, logFile, err := CreateLogger(appconfig)
					if logFile != nil {
						defer logFile.Close()
					}
					if err != nil {
						return err
					}

					defer func() {
						if err := recover(); err != nil {
							appLogger.Panic("panic occurred:", err)
						}
					}()

					// Same initialisation as `migrate`: this runs against a stopped instance, or
					// alongside a running one, and needs the database opened the ordinary way so
					// migrations and encryption settings are honoured.
					deviceRepo, err := database.NewRepository(appconfig, appLogger, event_bus.NewNoopEventBusServer())
					if err != nil {
						return err
					}

					path, err := web.ResetUserPassword(appconfig, deviceRepo, appLogger, username)
					if err != nil {
						return err
					}

					// The PATH, never the value — so the password stays out of shell history, CI
					// logs and screen recordings. The file self-deletes on that account's first
					// sign-in (#504/#466), because the data root is what a backup contains.
					fmt.Printf("Password for %q has been reset.\nThe new password is in: %s\nIt is deleted automatically the first time that account signs in.\n", username, path)
					return nil
				},
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "username",
						Usage:    "The account to reset",
						Required: true,
					},
					&cli.StringFlag{
						Name:  "config",
						Usage: "REMOVED. Configuration comes from .env and YOURPHR_* environment variables",
					},
					&cli.BoolFlag{
						Name:    "debug",
						Usage:   "Enable debug logging",
						EnvVars: []string{"DEBUG"},
					},
				},
			},
		},
	}

	err = app.Run(os.Args)
	if err != nil {
		log.Fatalf("ERROR: %v", err)
	}
}

func CreateLogger(appConfig config.Interface) (*logrus.Entry, *os.File, error) {
	logger := logrus.WithFields(logrus.Fields{
		"type": "web",
	})
	//set default log level
	if level, err := logrus.ParseLevel(appConfig.GetString("log.level")); err == nil {
		logger.Logger.SetLevel(level)
	} else {
		logger.Logger.SetLevel(logrus.InfoLevel)
	}

	// Keep the last N log lines in memory so the Admin Dashboard can always show recent logs and
	// change the level at runtime — no log.file, no restart (#170 follow-up).
	applog.Install(logger.Logger, 500)

	var logFile *os.File
	var err error
	if appConfig.IsSet("log.file") && len(appConfig.GetString("log.file")) > 0 {
		// O_APPEND so restarts add to the log instead of overwriting from offset 0 (which would
		// leave a corrupted mix of old + new bytes).
		logFile, err = os.OpenFile(appConfig.GetString("log.file"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			// File logging is a convenience (the Admin Dashboard reads this file). A bad/unwritable
			// path must NOT prevent the server from starting — fall back to STDOUT only and warn.
			logger.Logger.Errorf("Failed to open log file %s for output, continuing with STDOUT only: %s", appConfig.GetString("log.file"), err)
			logFile = nil
		} else {
			logger.Logger.SetOutput(io.MultiWriter(os.Stderr, logFile))
		}
	}
	return logger, logFile, nil
}

// rejectRemovedConfigFlag fails loudly when --config is passed, instead of ignoring it.
//
// The YAML configuration layer was removed in yourphr#474: bootstrap comes from .env and the
// YOURPHR_* environment, everything else from Admin -> Configuration. An operator still carrying
// --config in a systemd unit or a Makefile has real settings in that file, so accepting the flag
// and silently dropping them would recreate exactly the failure this removal was for — a
// configuration source that appears to be in effect and is not.
//
// Deleting the flag would also fail, with "flag provided but not defined: -config", which is true
// and tells nobody what to do instead. The flag is kept solely to produce this message.
func rejectRemovedConfigFlag(c *cli.Context) error {
	if !c.IsSet("config") {
		return nil
	}
	return fmt.Errorf(
		"--config was removed (%s is not read). Configuration now comes from .env plus YOURPHR_* "+
			"environment variables for bootstrap, and Admin -> Configuration for everything else. "+
			"Start from the template for your deployment: .env.docker.example, .env.baremetal.example, "+
			".env.k8s.example, or .env.dev.example. See docs/configuration-system.md",
		c.String("config"))
}
