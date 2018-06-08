SOURCES=$(wildcard */**/*.md) $(wildcard *.md)
HTML=$(patsubst %.md, build/%.html, $(SOURCES))
IMAGES=$(wildcard */**/*.jpg) $(wildcard *.jpg)
BUILT_IMAGES=$(patsubst %, build/%, $(IMAGES))

all: $(HTML) $(BUILT_IMAGES)

build/%.jpg: %.jpg
	mkdir --parents $(dir $@)
	cp $< $@

build/%.html: %.md
	mkdir --parents $(dir $@)
	pandoc -s $< -o $@

.PHONY:
clean:
	rm -rf ./build
