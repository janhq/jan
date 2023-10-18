newadr:
	@echo "Initiating an ADR..."
	@last_number=$$(ls $(CURDIR)/adr-[0-9][0-9][0-9]-* | sort -V | tail -n 1 | cut -d '-' -f 2); \
	last_number=$$(echo $$last_number | sed 's/^0*//'); \
	next_number=$$(printf "%03d" $$(( $$last_number + 1 ))); \
	read -p "Enter ADR title: " title; \
	title=$$(echo $$title | tr ' ' '-'); \
	cp $(CURDIR)/adr-template.md $(CURDIR)/adr-$$next_number-$$title.md; \
	date=$$(date +%Y-%m-%d); \
	usernames=$$(git config user.name); \
	sed -i '' 's/{ADR-NUM}/'$$next_number'/g' $(CURDIR)/adr-$$next_number-$$title.md; \
	sed -i '' 's/{TITLE}/'$$title'/g' $(CURDIR)/adr-$$next_number-$$title.md; \
	sed -i '' 's/{DATE}/'$$date'/g' $(CURDIR)/adr-$$next_number-$$title.md; \
	sed -i '' 's/{USERNAMES}/'$$usernames'/g' $(CURDIR)/adr-$$next_number-$$title.md