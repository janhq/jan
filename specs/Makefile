spec:
	@echo "Initiating a Spec..."
	@last_number=$$(ls $(CURDIR)/jan-[0-9][0-9][0-9]-* | sort -V | tail -n 1 | cut -d '-' -f 2); \
	last_number=$$(echo $$last_number | sed 's/^0*//'); \
	next_number=$$(printf "%03d" $$(( $$last_number + 1 ))); \
	read -p "Enter Spec title: " title; \
	title=$$(echo $$title | tr ' ' '-'); \
	cp $(CURDIR)/spec-template.md $(CURDIR)/jan-$$next_number-$$title.md; \
	date=$$(date +%Y-%m-%d); \
	usernames=$$(git config user.name); \
	sed -i '' 's/{SPEC-NUM}/'$$next_number'/g' $(CURDIR)/jan-$$next_number-$$title.md; \
	sed -i '' 's/{TITLE}/'$$title'/g' $(CURDIR)/jan-$$next_number-$$title.md; \
	sed -i '' 's/{DATE}/'$$date'/g' $(CURDIR)/jan-$$next_number-$$title.md; \
	sed -i '' 's/{USERNAMES}/'$$usernames'/g' $(CURDIR)/jan-$$next_number-$$title.md