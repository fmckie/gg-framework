#include "bindings/bindings.h"

int main(int argc, char * argv[]) {
	ffi::kleio_live_install(ffi::kleio_live_begin, ffi::kleio_live_start,
	                        ffi::kleio_live_end_finished);
	ffi::start_app();
	return 0;
}
